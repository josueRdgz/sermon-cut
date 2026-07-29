mod backend;

use std::sync::Arc;

use log::{error, info};
use tauri::{AppHandle, Manager, RunEvent, State};

use crate::backend::BackendHandle;

struct AppState {
    backend: Arc<BackendHandle>,
}

#[tauri::command]
fn get_api_base_url(state: State<'_, AppState>) -> String {
    state.backend.api_base_url()
}

#[tauri::command]
fn get_backend_port(state: State<'_, AppState>) -> u16 {
    state.backend.port
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Always log in the desktop shell so startup failures are visible.
    let mut builder = tauri::Builder::default().plugin(
        tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
    );

    builder = builder
        .invoke_handler(tauri::generate_handler![get_api_base_url, get_backend_port])
        .setup(|app| {
            info!("Sermon Cut desktop starting…");
            match backend::start_backend(app.handle()) {
                Ok(handle) => {
                    let handle = Arc::new(handle);
                    app.manage(AppState {
                        backend: Arc::clone(&handle),
                    });
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    info!("UI ready; API at {}", handle.api_base_url());
                    Ok(())
                }
                Err(err) => {
                    error!("Backend failed to start: {err}");
                    Err(err.into())
                }
            }
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building Sermon Cut desktop");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            shutdown_backend(app_handle);
        }
    });
}

fn shutdown_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        info!("Shutting down FastAPI child process");
        state.backend.shutdown();
    }
}
