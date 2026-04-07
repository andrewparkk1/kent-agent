use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

type ChildHandle = Arc<Mutex<Option<Child>>>;

fn wait_for_server(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect("127.0.0.1:3456").is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn sidecar_path(name: &str) -> std::path::PathBuf {
    let exe = std::env::current_exe().expect("failed to get exe path");
    let dir = exe.parent().expect("failed to get exe dir");
    // Tauri strips the target triple suffix when bundling externalBin
    dir.join(name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server: ChildHandle = Arc::new(Mutex::new(None));
    let daemon: ChildHandle = Arc::new(Mutex::new(None));

    let server_cleanup = server.clone();
    let daemon_cleanup = daemon.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            let server_setup = server.clone();
            let daemon_setup = daemon.clone();

            std::thread::spawn(move || {
                let resource_dir = handle
                    .path()
                    .resource_dir()
                    .expect("failed to resolve resource dir");
                let static_dir = resource_dir.join("dist-bundle");

                let server_bin = sidecar_path("kent-server");
                let daemon_bin = sidecar_path("kent-daemon");
                let agent_bin = sidecar_path("kent-agent");

                log::info!("Starting kent-server from {:?}", server_bin);
                match Command::new(&server_bin)
                    .env("KENT_STATIC_DIR", &static_dir)
                    .spawn()
                {
                    Ok(child) => {
                        log::info!("kent-server started (pid {})", child.id());
                        *server_setup.lock().unwrap() = Some(child);
                    }
                    Err(e) => {
                        log::error!("Failed to start kent-server: {e}");
                        return;
                    }
                }

                log::info!("Starting kent-daemon from {:?}", daemon_bin);
                match Command::new(&daemon_bin)
                    .env("KENT_AGENT_BIN", &agent_bin)
                    .spawn()
                {
                    Ok(child) => {
                        log::info!("kent-daemon started (pid {})", child.id());
                        *daemon_setup.lock().unwrap() = Some(child);
                    }
                    Err(e) => log::error!("Failed to start kent-daemon: {e}"),
                }

                if !wait_for_server(Duration::from_secs(10)) {
                    log::error!("kent-server failed to become ready within 10s");
                }

                if let Some(window) = handle.get_webview_window("main") {
                    let _ =
                        window.eval("window.location.replace('http://localhost:3456')");
                    std::thread::sleep(Duration::from_millis(300));
                    let _ = window.show();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = server_cleanup.lock().unwrap().take() {
                    log::info!("Stopping kent-server");
                    let _ = child.kill();
                }
                if let Some(mut child) = daemon_cleanup.lock().unwrap().take() {
                    log::info!("Stopping kent-daemon");
                    let _ = child.kill();
                }
            }
        });
}
