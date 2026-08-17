use serde::Serialize;
use std::fs;
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConnection {
    endpoint: String,
    session_token: String,
}

struct RuntimeState {
    endpoint: String,
    session_token: String,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn runtime_connection(state: State<'_, RuntimeState>) -> RuntimeConnection {
    RuntimeConnection {
        endpoint: state.endpoint.clone(),
        session_token: state.session_token.clone(),
    }
}

fn start_core(app: &tauri::App) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;
    let data_dir = app.path().app_local_data_dir()?;
    fs::create_dir_all(&data_dir)?;
    let config_path = resource_dir.join("resources").join("jarvis.config.yaml");
    let browser_module_root = resource_dir
        .join("resources")
        .join("browser-runtime")
        .join("package.json");
    let token = app.state::<RuntimeState>().session_token.clone();
    let (mut events, child) = app
        .shell()
        .sidecar("jarvis-core")?
        .current_dir(&resource_dir)
        .env("NODE_ENV", "production")
        .env("JARVIS_BROWSER_MODULE_ROOT", browser_module_root)
        .env("JARVIS_CONFIG_PATH", config_path)
        .env("JARVIS_DATA_DIR", data_dir)
        .env("JARVIS_PARENT_PID", std::process::id().to_string())
        .env("JARVIS_RESOURCE_DIR", resource_dir)
        .env("JARVIS_SESSION_TOKEN", token)
        .env("JARVIS_VERSION", env!("CARGO_PKG_VERSION"))
        .spawn()?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Terminated(status) => {
                    eprintln!("JARVIS Core stopped with status {:?}", status.code);
                }
                CommandEvent::Error(message) => {
                    eprintln!("JARVIS Core process error: {message}");
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("JARVIS Core: {}", String::from_utf8_lossy(&line));
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = RuntimeState {
        endpoint: "http://127.0.0.1:43117".to_string(),
        session_token: format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4()),
        child: Mutex::new(None),
    };
    let app =
        tauri::Builder::default()
            .manage(state)
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .plugin(tauri_plugin_autostart::Builder::new().build())
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .invoke_handler(tauri::generate_handler![runtime_connection])
            .setup(|app| {
                let child = start_core(app)?;
                *app.state::<RuntimeState>().child.lock().map_err(|_| {
                    std::io::Error::other("JARVIS Core process state is unavailable")
                })? = Some(child);
                Ok(())
            })
            .build(tauri::generate_context!())
            .expect("error while building JARVIS dashboard");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Ok(mut child) = app_handle.state::<RuntimeState>().child.lock() {
                if let Some(child) = child.take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
