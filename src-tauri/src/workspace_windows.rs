//! Secondary windows route semantic requests to the main window. No Workspace
//! state, credentials, or completed request history belongs in this broker.
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::{oneshot, Mutex};

const MAIN: &str = "main";
const OWNER_UNAVAILABLE: &str = "owner unavailable";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

type Reply = Result<Value, String>;
type RequestKey = (String, String);

struct Pending {
    // Identity prevents an old timeout from removing a newer request's slot.
    identity: Arc<()>,
    response: oneshot::Sender<Reply>,
    request: Option<WorkspaceRequest>,
    deadline: tokio::time::Instant,
}

#[derive(Default)]
struct Routing {
    owner_ready: bool,
    pending: HashMap<RequestKey, Pending>,
}

#[derive(Default)]
pub struct WorkspaceBroker {
    routing: Arc<Mutex<Routing>>,
    window_open: Mutex<()>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRequest {
    request_id: String,
    requester_label: String,
    action: Value,
}

pub(crate) fn require_main(label: &str) -> Result<(), String> {
    if label == MAIN {
        Ok(())
    } else {
        Err("only main may own the workspace".into())
    }
}

fn validate_action(label: &str, action: &Value) -> Result<(), String> {
    let kind = action.get("kind").and_then(Value::as_str);
    match (label, kind) {
        ("space-settings", Some("space.create"))
        | ("thread-archive", Some("archive.list" | "archive.read" | "archive.unarchive")) => Ok(()),
        (MAIN, _) => Err("main cannot request its own workspace".into()),
        _ => Err("workspace action is not allowed for this window".into()),
    }
}

impl WorkspaceBroker {
    async fn set_owner_ready(&self, ready: bool) {
        let mut routing = self.routing.lock().await;
        routing.owner_ready = ready;
        if !ready {
            for (_, pending) in routing.pending.drain() {
                let _ = pending.response.send(Err(OWNER_UNAVAILABLE.into()));
            }
        }
    }

    async fn requester_destroyed(&self, label: &str) {
        let mut routing = self.routing.lock().await;
        routing
            .pending
            .retain(|(requester, _), _| requester != label);
    }

    // Keep the synchronous targeted emit under the routing lock: a response,
    // readiness change, or destroy cleanup cannot interleave registration/emit.
    async fn dispatch(
        &self,
        requester_label: &str,
        request_id: String,
        action: Value,
        timeout: Duration,
        emit: impl FnOnce(&WorkspaceRequest) -> Result<(), String>,
    ) -> Result<oneshot::Receiver<Reply>, String> {
        validate_action(requester_label, &action)?;
        if request_id.trim().is_empty() {
            return Err("requestId must not be empty".into());
        }
        let key = (requester_label.to_owned(), request_id.clone());
        let identity = Arc::new(());
        let (response, owner_reply) = oneshot::channel();
        let mut routing = self.routing.lock().await;
        // Responses carry only requestId, so it must be unambiguous across
        // requester labels. Callers must use a fresh ID for every invocation.
        if !routing.owner_ready || routing.pending.keys().any(|(_, id)| id == &request_id) {
            return Err(OWNER_UNAVAILABLE.into());
        }
        let payload = WorkspaceRequest {
            request_id,
            requester_label: requester_label.into(),
            action,
        };
        let deadline = tokio::time::Instant::now() + timeout;
        routing.pending.insert(
            key.clone(),
            Pending {
                identity: identity.clone(),
                response,
                request: Some(payload.clone()),
                deadline,
            },
        );
        if let Err(error) = emit(&payload) {
            routing.pending.remove(&key);
            return Err(error);
        }
        drop(routing);

        let (caller_reply, receiver) = oneshot::channel();
        let routing = self.routing.clone();
        // Own the timer independently of the invoke future. A cancelled invoke
        // (e.g. StrictMode/unmount) cannot leave an immortal pending entry.
        tokio::spawn(async move {
            let reply = match tokio::time::timeout_at(deadline, owner_reply).await {
                Ok(Ok(reply)) => reply,
                _ => Err(OWNER_UNAVAILABLE.into()),
            };
            let mut routing = routing.lock().await;
            if routing
                .pending
                .get(&key)
                .is_some_and(|pending| Arc::ptr_eq(&pending.identity, &identity))
            {
                routing.pending.remove(&key);
            }
            drop(routing);
            let _ = caller_reply.send(reply);
        });
        Ok(receiver)
    }

    async fn claim(&self, request_id: &str) -> Result<WorkspaceRequest, String> {
        let mut routing = self.routing.lock().await;
        if !routing.owner_ready {
            return Err(OWNER_UNAVAILABLE.into());
        }
        routing
            .pending
            .iter_mut()
            .find(|((_, id), _)| id == request_id)
            .and_then(|(_, pending)| {
                if tokio::time::Instant::now() >= pending.deadline {
                    None
                } else {
                    pending.request.take()
                }
            })
            .ok_or_else(|| OWNER_UNAVAILABLE.to_owned())
    }

    async fn respond(&self, request_id: &str, reply: Reply) -> Result<(), String> {
        let mut routing = self.routing.lock().await;
        let key = routing
            .pending
            .keys()
            .find(|(_, id)| id == request_id)
            .cloned()
            .ok_or_else(|| OWNER_UNAVAILABLE.to_owned())?;
        let pending = routing.pending.remove(&key).unwrap();
        pending
            .response
            .send(reply)
            .map_err(|_| OWNER_UNAVAILABLE.to_owned())
    }
}

struct WindowSpec {
    label: &'static str,
    url: &'static str,
    title: &'static str,
    size: (f64, f64),
    min_size: (f64, f64),
}

const SPACE_SETTINGS: WindowSpec = WindowSpec {
    label: "space-settings",
    url: "index.html?window=space-settings",
    title: "New Space",
    size: (600.0, 520.0),
    min_size: (480.0, 420.0),
};

const THREAD_ARCHIVE: WindowSpec = WindowSpec {
    label: "thread-archive",
    url: "index.html?window=thread-archive",
    title: "Thread archive",
    size: (820.0, 680.0),
    min_size: (600.0, 480.0),
};

async fn open_window(
    requester: WebviewWindow,
    app: AppHandle,
    spec: &WindowSpec,
) -> Result<(), String> {
    require_main(requester.label())?;
    let broker = app.state::<WorkspaceBroker>();
    // Concurrent invokes must not both try to construct the same label.
    let _open = broker.window_open.lock().await;
    if app.get_webview_window(MAIN).is_none() {
        return Err(OWNER_UNAVAILABLE.into());
    }
    if let Some(window) = app.get_webview_window(spec.label) {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    WebviewWindowBuilder::new(&app, spec.label, WebviewUrl::App(spec.url.into()))
        .title(spec.title)
        .inner_size(spec.size.0, spec.size.1)
        .min_inner_size(spec.min_size.0, spec.min_size.1)
        .resizable(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .background_color(tauri::window::Color(0xeb, 0xe7, 0xe2, 255))
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_space_settings(requester: WebviewWindow, app: AppHandle) -> Result<(), String> {
    open_window(requester, app, &SPACE_SETTINGS).await
}

#[tauri::command]
pub async fn open_thread_archive(requester: WebviewWindow, app: AppHandle) -> Result<(), String> {
    open_window(requester, app, &THREAD_ARCHIVE).await
}

#[tauri::command]
pub async fn workspace_request(
    requester: WebviewWindow,
    app: AppHandle,
    request_id: String,
    action: Value,
) -> Reply {
    let receiver = app
        .state::<WorkspaceBroker>()
        .dispatch(
            requester.label(),
            request_id,
            action,
            REQUEST_TIMEOUT,
            |payload| {
                if app.get_webview_window(MAIN).is_none() {
                    return Err(OWNER_UNAVAILABLE.into());
                }
                app.emit_to(MAIN, "workspace-request", payload)
                    .map_err(|error| error.to_string())
            },
        )
        .await?;
    receiver
        .await
        .unwrap_or_else(|_| Err(OWNER_UNAVAILABLE.into()))
}

#[tauri::command]
pub async fn workspace_claim_request(
    requester: WebviewWindow,
    app: AppHandle,
    request_id: String,
) -> Result<WorkspaceRequest, String> {
    require_main(requester.label())?;
    app.state::<WorkspaceBroker>().claim(&request_id).await
}

#[tauri::command]
pub async fn workspace_response(
    requester: WebviewWindow,
    app: AppHandle,
    request_id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    require_main(requester.label())?;
    if app.get_webview_window(MAIN).is_none() {
        return Err(OWNER_UNAVAILABLE.into());
    }
    let reply = match error {
        Some(error) => Err(error),
        None => Ok(result.unwrap_or(Value::Null)),
    };
    app.state::<WorkspaceBroker>()
        .respond(&request_id, reply)
        .await
}

#[tauri::command]
pub async fn workspace_owner_ready(
    requester: WebviewWindow,
    app: AppHandle,
    ready: bool,
) -> Result<(), String> {
    require_main(requester.label())?;
    if app.get_webview_window(MAIN).is_none() {
        return Err(OWNER_UNAVAILABLE.into());
    }
    app.state::<WorkspaceBroker>().set_owner_ready(ready).await;
    Ok(())
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if !matches!(event, tauri::WindowEvent::Destroyed) {
        return;
    }
    let label = window.label().to_owned();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let broker = app.state::<WorkspaceBroker>();
        if label == MAIN {
            broker.set_owner_ready(false).await;
        } else {
            broker.requester_destroyed(&label).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::future::Future;

    fn run(future: impl Future<Output = ()>) {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future);
    }

    async fn request(
        broker: &WorkspaceBroker,
        label: &str,
        id: &str,
    ) -> Result<oneshot::Receiver<Reply>, String> {
        let kind = if label == SPACE_SETTINGS.label {
            "space.create"
        } else {
            "archive.list"
        };
        broker
            .dispatch(
                label,
                id.into(),
                json!({"kind": kind}),
                REQUEST_TIMEOUT,
                |_| Ok(()),
            )
            .await
    }

    #[test]
    fn enforces_window_action_and_owner_allowlists() {
        for kind in ["archive.list", "archive.read", "archive.unarchive"] {
            assert!(validate_action("thread-archive", &json!({"kind": kind})).is_ok());
            assert!(validate_action("space-settings", &json!({"kind": kind})).is_err());
        }
        assert!(validate_action("space-settings", &json!({"kind":"space.create"})).is_ok());
        for label in ["main", "settings", "unknown", "thread-archive"] {
            assert!(validate_action(label, &json!({"kind":"space.create"})).is_err());
        }
        for action in [
            Value::Null,
            json!("archive.list"),
            json!({}),
            json!({"kind":7}),
        ] {
            assert!(validate_action("thread-archive", &action).is_err());
        }
        assert!(require_main("main").is_ok());
        assert!(require_main("thread-archive").is_err());
    }

    #[test]
    fn payload_uses_the_frontend_contract() {
        let payload = WorkspaceRequest {
            request_id: "id".into(),
            requester_label: "space-settings".into(),
            action: json!({"kind":"space.create", "name":"Research"}),
        };
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            json!({"requestId":"id", "requesterLabel":"space-settings",
                   "action":{"kind":"space.create", "name":"Research"}})
        );
    }

    #[test]
    fn claims_only_registered_actions_once_and_ignores_forged_notifications() {
        run(async {
            let broker = WorkspaceBroker::default();
            broker.set_owner_ready(true).await;
            assert!(broker.claim("forged").await.is_err());
            let receiver = request(&broker, "thread-archive", "registered")
                .await
                .unwrap();
            let claimed = broker.claim("registered").await.unwrap();
            assert_eq!(claimed.requester_label, "thread-archive");
            assert_eq!(claimed.action, json!({"kind":"archive.list"}));
            assert!(broker.claim("registered").await.is_err());
            broker.respond("registered", Ok(Value::Null)).await.unwrap();
            assert_eq!(receiver.await.unwrap(), Ok(Value::Null));
            assert!(broker.claim("registered").await.is_err());
            let receiver = request(&broker, "thread-archive", "lost-owner")
                .await
                .unwrap();
            broker.set_owner_ready(false).await;
            assert!(broker.claim("lost-owner").await.is_err());
            assert_eq!(receiver.await.unwrap(), Err(OWNER_UNAVAILABLE.into()));
        });
    }

    #[test]
    fn expired_action_cannot_be_claimed_before_detached_timeout_cleanup_runs() {
        run(async {
            let broker = WorkspaceBroker::default();
            broker.set_owner_ready(true).await;
            let receiver = broker
                .dispatch(
                    "thread-archive",
                    "expired".into(),
                    json!({"kind":"archive.list"}),
                    Duration::ZERO,
                    |_| Ok(()),
                )
                .await
                .unwrap();
            // No runtime yield: the detached timeout task has not been polled.
            assert!(broker.claim("expired").await.is_err());
            assert_eq!(receiver.await.unwrap(), Err(OWNER_UNAVAILABLE.into()));
        });
    }

    #[test]
    fn readiness_duplicates_and_responses_are_scoped() {
        run(async {
            let broker = WorkspaceBroker::default();
            assert_eq!(
                request(&broker, "thread-archive", "a").await.unwrap_err(),
                OWNER_UNAVAILABLE
            );
            broker.set_owner_ready(true).await;
            let first = request(&broker, "thread-archive", "a").await.unwrap();
            let second = request(&broker, "space-settings", "b").await.unwrap();
            for label in ["thread-archive", "space-settings"] {
                assert_eq!(
                    request(&broker, label, "a").await.unwrap_err(),
                    OWNER_UNAVAILABLE
                );
            }
            assert!(broker.respond("unknown", Ok(Value::Null)).await.is_err());
            assert_eq!(broker.routing.lock().await.pending.len(), 2);
            broker
                .respond("a", Ok(json!([{"id": "thread"}])))
                .await
                .unwrap();
            assert_eq!(first.await.unwrap(), Ok(json!([{"id": "thread"}])));
            assert_eq!(broker.routing.lock().await.pending.len(), 1);
            broker
                .respond("b", Err("invalid space name".into()))
                .await
                .unwrap();
            assert_eq!(second.await.unwrap(), Err("invalid space name".into()));
            assert!(broker.routing.lock().await.pending.is_empty());
            assert!(broker.respond("a", Ok(Value::Null)).await.is_err());
        });
    }

    #[test]
    fn old_completion_cleanup_cannot_remove_a_new_pending_slot() {
        run(async {
            let broker = WorkspaceBroker::default();
            broker.set_owner_ready(true).await;
            let old = request(&broker, "thread-archive", "same-id").await.unwrap();
            broker.respond("same-id", Ok(Value::Null)).await.unwrap();
            // The old detached task has not been polled yet on this runtime.
            let new = request(&broker, "thread-archive", "same-id").await.unwrap();
            assert_eq!(old.await.unwrap(), Ok(Value::Null));
            assert_eq!(broker.routing.lock().await.pending.len(), 1);
            broker
                .respond("same-id", Ok(json!({"new": true})))
                .await
                .unwrap();
            assert_eq!(new.await.unwrap(), Ok(json!({"new": true})));
            assert!(broker.routing.lock().await.pending.is_empty());
        });
    }

    #[test]
    fn owner_cleanup_fails_all_and_requires_a_new_ready_signal() {
        run(async {
            let broker = WorkspaceBroker::default();
            broker.set_owner_ready(true).await;
            let archive = request(&broker, "thread-archive", "a").await.unwrap();
            let space = request(&broker, "space-settings", "b").await.unwrap();
            broker.set_owner_ready(false).await;
            assert_eq!(archive.await.unwrap(), Err(OWNER_UNAVAILABLE.into()));
            assert_eq!(space.await.unwrap(), Err(OWNER_UNAVAILABLE.into()));
            assert!(broker.routing.lock().await.pending.is_empty());
            assert!(request(&broker, "thread-archive", "c").await.is_err());
            broker.set_owner_ready(true).await;
            let after_remount = request(&broker, "thread-archive", "c").await.unwrap();
            broker.respond("c", Ok(Value::Null)).await.unwrap();
            assert_eq!(after_remount.await.unwrap(), Ok(Value::Null));
        });
    }

    #[test]
    fn emit_failure_preserves_real_error_and_cleans_registration() {
        run(async {
            let broker = WorkspaceBroker::default();
            broker.set_owner_ready(true).await;
            let failure = broker
                .dispatch(
                    "thread-archive",
                    "a".into(),
                    json!({"kind":"archive.list"}),
                    REQUEST_TIMEOUT,
                    |_| Err("emit failed".into()),
                )
                .await;
            assert_eq!(failure.unwrap_err(), "emit failed");
            assert!(broker.routing.lock().await.pending.is_empty());
            assert!(request(&broker, "thread-archive", "  ").await.is_err());
        });
    }

    #[test]
    fn timeout_and_cancelled_invokes_do_not_leak_pending() {
        run(async {
            let broker = WorkspaceBroker::default();
            broker.set_owner_ready(true).await;
            let receiver = broker
                .dispatch(
                    "thread-archive",
                    "timeout".into(),
                    json!({"kind":"archive.list"}),
                    Duration::from_millis(5),
                    |_| Ok(()),
                )
                .await
                .unwrap();
            assert_eq!(receiver.await.unwrap(), Err(OWNER_UNAVAILABLE.into()));
            assert!(broker.routing.lock().await.pending.is_empty());
            assert!(broker.respond("timeout", Ok(Value::Null)).await.is_err());
            let cancelled = broker
                .dispatch(
                    "space-settings",
                    "cancelled".into(),
                    json!({"kind":"space.create"}),
                    Duration::from_millis(5),
                    |_| Ok(()),
                )
                .await
                .unwrap();
            drop(cancelled);
            tokio::time::sleep(Duration::from_millis(20)).await;
            assert!(broker.routing.lock().await.pending.is_empty());
        });
    }

    #[test]
    fn requester_destroy_only_cancels_its_own_pending() {
        run(async {
            let broker = WorkspaceBroker::default();
            broker.set_owner_ready(true).await;
            let archive = request(&broker, "thread-archive", "a").await.unwrap();
            let space = request(&broker, "space-settings", "b").await.unwrap();
            broker.requester_destroyed("thread-archive").await;
            assert_eq!(archive.await.unwrap(), Err(OWNER_UNAVAILABLE.into()));
            assert_eq!(broker.routing.lock().await.pending.len(), 1);
            broker
                .respond("b", Ok(json!({"id":"space"})))
                .await
                .unwrap();
            assert_eq!(space.await.unwrap(), Ok(json!({"id":"space"})));
            assert!(broker.routing.lock().await.owner_ready);
        });
    }
}
