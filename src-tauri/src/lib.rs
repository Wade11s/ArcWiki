mod settings;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use uuid::Uuid;

use settings::{
    apply_save, avatar_data_url_for_save, decode_png_data_url, load_avatar_data_url,
    load_stored_settings, profile_changed, public_settings, remove_avatar, resolve_settings,
    write_avatar, write_stored_settings, EnvSnapshot, PublicSettings, ResolvedSettings,
    SaveSettingsInput, SettingsChanged,
};

const SETTINGS_WINDOW_LABEL: &str = "settings";

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
    generation: Mutex<u64>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            status: Mutex::new(BackendStatus::Starting),
            child: Mutex::new(None),
            generation: Mutex::new(0),
        }
    }
}

fn ready_port(line: &[u8]) -> Option<u16> {
    std::str::from_utf8(line)
        .ok()?
        .trim()
        .strip_prefix("ARCWIKI_READY:")?
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
}

fn resolve_from_app(app: &AppHandle) -> ResolvedSettings {
    let stored = app
        .path()
        .app_config_dir()
        .map(|dir| load_stored_settings(&dir))
        .unwrap_or_default();
    resolve_settings(&stored, &EnvSnapshot::from_process())
}

fn wiki_data_dir(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?.join("wiki");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn start_sidecar(app: AppHandle, wiki_dir: &Path) {
    let token = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let generation = {
        let state = app.state::<BackendState>();
        let mut generation = state.generation.lock().unwrap();
        *generation += 1;
        *state.status.lock().unwrap() = BackendStatus::Starting;
        if let Some(child) = state.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        *generation
    };
    let resolved = resolve_from_app(&app);
    let spawned = app
        .shell()
        .sidecar("arcwiki-sidecar")
        .map(|command| {
            command
                .env("ARCWIKI_PORT", "0")
                .env("ARCWIKI_SESSION_TOKEN", &token)
                .env("ARCWIKI_WIKI_DIR", wiki_dir)
                .env(
                    "OPENROUTER_API_KEY",
                    resolved.api_key.clone().unwrap_or_default(),
                )
                .env("OPENROUTER_BASE_URL", &resolved.base_url)
                .env("OPENROUTER_MODEL", &resolved.model)
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
                                let state = app.state::<BackendState>();
                                if *state.generation.lock().unwrap() == generation {
                                    *state.status.lock().unwrap() =
                                        BackendStatus::Ready(BackendConnection {
                                            port,
                                            token: token.clone(),
                                        });
                                }
                            }
                        }
                        CommandEvent::Terminated(_) | CommandEvent::Error(_) => {
                            let state = app.state::<BackendState>();
                            if *state.generation.lock().unwrap() == generation {
                                *state.status.lock().unwrap() = BackendStatus::Failed(
                                    "Agent service stopped. Restart ArcWiki.".into(),
                                );
                            }
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
            let state = app.state::<BackendState>();
            if *state.generation.lock().unwrap() == generation {
                *state.status.lock().unwrap() = BackendStatus::Failed(
                    "Agent service could not start. Rebuild the sidecar.".into(),
                );
            }
        }
    }
}

fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Settings")
    .inner_size(680.0, 640.0)
    .min_inner_size(560.0, 480.0)
    .resizable(true)
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .background_color(tauri::window::Color(0xeb, 0xe7, 0xe2, 255))
    .center()
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::with_id("settings", "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .close_window()
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(app, "ArcWiki")
            .about(None)
            .separator()
            .item(&settings_item)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app)
            .item(&app_menu)
            .item(&edit_menu)
            .item(&window_menu)
            .build()?
    };

    #[cfg(not(target_os = "macos"))]
    let menu = {
        let file_menu = SubmenuBuilder::new(app, "File")
            .item(&settings_item)
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app)
            .item(&file_menu)
            .item(&edit_menu)
            .item(&window_menu)
            .build()?
    };

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == "settings" {
            let _ = open_settings_window(app);
        }
    });
    Ok(())
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

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<PublicSettings, String> {
    let resolved = resolve_from_app(&app);
    let avatar = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| load_avatar_data_url(&dir));
    Ok(public_settings(&resolved, avatar))
}

#[tauri::command]
fn save_settings(app: AppHandle, input: SaveSettingsInput) -> Result<PublicSettings, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let mut stored = load_stored_settings(&config_dir);
    let env = EnvSnapshot::from_process();
    let before = resolve_settings(&stored, &env);
    apply_save(&mut stored, &input)?;
    if let Some(data_url) = input
        .avatar_data_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        write_avatar(&config_dir, &decode_png_data_url(data_url)?)?;
    } else if input.clear_avatar == Some(true) {
        remove_avatar(&config_dir)?;
    }
    write_stored_settings(&config_dir, &stored)?;
    let after = resolve_settings(&stored, &env);
    let agent_changed = before.api_key != after.api_key
        || before.base_url != after.base_url
        || before.model != after.model;
    if agent_changed {
        let wiki_dir = wiki_data_dir(&app).map_err(|error| error.to_string())?;
        start_sidecar(app.clone(), &wiki_dir);
    }
    let profile_did_change = profile_changed(&before, &after, &input);
    app.emit(
        "settings-changed",
        SettingsChanged {
            reading_width: after.reading_width,
            agent_changed,
            agent_configured: after.api_key.is_some(),
            display_name: after.display_name.clone(),
            profile_changed: profile_did_change,
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(public_settings(
        &after,
        avatar_data_url_for_save(&config_dir, profile_did_change),
    ))
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    open_settings_window(&app)
}

pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            get_backend_connection,
            get_settings,
            save_settings,
            open_settings
        ])
        .setup(|app| {
            install_menu(app)?;
            let wiki_dir = wiki_data_dir(app.handle())?;
            start_sidecar(app.handle().clone(), &wiki_dir);
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
