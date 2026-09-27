use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use uuid::Uuid;

#[derive(Clone, Serialize)]
struct BackendConnection {
    port: u16,
    token: String,
}

enum BackendStatus {
    Starting,
    Ready(BackendConnection),
    Failed(String),
}

struct BackendState {
    status: Mutex<BackendStatus>,
    child: Mutex<Option<CommandChild>>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            status: Mutex::new(BackendStatus::Starting),
            child: Mutex::new(None),
        }
    }
}

// The sidecar binds an OS-assigned loopback port, avoiding collisions between app instances.
// It prints a single readiness line after it begins listening.
fn ready_port(line: &[u8]) -> Option<u16> {
    std::str::from_utf8(line)
        .ok()?
        .trim()
        .strip_prefix("ARCWIKI_READY:")?
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
}

fn start_sidecar(app: AppHandle) {
    let token = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let spawned = app
        .shell()
        .sidecar("arcwiki-sidecar")
        .map(|command| {
            command
                .env("ARCWIKI_PORT", "0")
                .env("ARCWIKI_SESSION_TOKEN", &token)
        })
        .and_then(|command| command.spawn());

    match spawned {
        Ok((mut events, child)) => {
            *app.state::<BackendState>().child.lock().unwrap() = Some(child);
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            if let Some(port) = ready_port(&line) {
                                *app.state::<BackendState>().status.lock().unwrap() =
                                    BackendStatus::Ready(BackendConnection {
                                        port,
                                        token: token.clone(),
                                    });
                            }
                        }
                        CommandEvent::Terminated(_) | CommandEvent::Error(_) => {
                            *app.state::<BackendState>().status.lock().unwrap() =
                                BackendStatus::Failed(
                                    "Agent service stopped. Restart ArcWiki.".into(),
                                );
                            break;
                        }
                        CommandEvent::Stderr(_) => {
                            // Do not forward sidecar stderr to the UI: it may contain provider details.
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(_) => {
            *app.state::<BackendState>().status.lock().unwrap() =
                BackendStatus::Failed("Agent service could not start. Rebuild the sidecar.".into());
        }
    }
}

#[tauri::command]
async fn get_backend_connection(
    state: State<'_, BackendState>,
) -> Result<BackendConnection, String> {
    for _ in 0..100 {
        {
            let status = state
                .status
                .lock()
                .map_err(|_| "Agent service lock failed")?;
            match &*status {
                BackendStatus::Ready(connection) => return Ok(connection.clone()),
                BackendStatus::Failed(message) => return Err(message.clone()),
                BackendStatus::Starting => {}
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("Agent service did not become ready. Restart ArcWiki.".into())
}

pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());
    // The embedded WebDriver server is never present in normal desktop builds.
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![get_backend_connection])
        .setup(|app| {
            start_sidecar(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to initialize ArcWiki");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(child) = handle.state::<BackendState>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::ready_port;

    #[test]
    fn accepts_only_nonzero_readiness_ports() {
        assert_eq!(ready_port(b"ARCWIKI_READY:49152\n"), Some(49152));
        assert_eq!(ready_port(b"ARCWIKI_READY:0"), None);
        assert_eq!(ready_port(b"debug 49152"), None);
        assert_eq!(ready_port(b"ARCWIKI_READY:not-a-port"), None);
    }
}
