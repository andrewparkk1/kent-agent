use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

type ChildHandle = Arc<Mutex<Option<Child>>>;

fn wait_for_server(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect("127.0.0.1:19456").is_ok() {
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

            // Check for updates in the background (non-blocking)
            let updater_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Wait a few seconds to let the app settle before checking
                std::thread::sleep(Duration::from_secs(5));
                tauri::async_runtime::block_on(async {
                    match updater_handle.updater() {
                        Ok(updater) => {
                            match updater.check().await {
                                Ok(Some(update)) => {
                                    log::info!("Update available: v{}", update.version);
                                    // dialog: true in tauri.conf.json shows a native
                                    // prompt — user chooses to install or skip
                                    if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                                        log::error!("Failed to install update: {e}");
                                    }
                                }
                                Ok(None) => log::info!("App is up to date"),
                                Err(e) => log::error!("Update check failed: {e}"),
                            }
                        }
                        Err(e) => log::error!("Updater not available: {e}"),
                    }
                });
            });

            let handle = app.handle().clone();
            let server_setup = server.clone();
            let daemon_setup = daemon.clone();

            std::thread::spawn(move || {
                let already_running =
                    TcpStream::connect("127.0.0.1:19456").is_ok();

                if already_running {
                    log::info!("kent-server already running on port 19456, reusing");
                } else {
                    let resource_dir = handle
                        .path()
                        .resource_dir()
                        .expect("failed to resolve resource dir");
                    let static_dir = resource_dir.join("dist-bundle");
                    let prompts_dir = resource_dir.join("prompts");

                    let server_bin = sidecar_path("kent-server");
                    let daemon_bin = sidecar_path("kent-daemon");
                    let agent_bin = sidecar_path("kent-agent");

                    log::info!("Starting kent-server from {:?}", server_bin);
                    match Command::new(&server_bin)
                        .env("KENT_STATIC_DIR", &static_dir)
                        .env("KENT_PROMPTS_DIR", &prompts_dir)
                        .spawn()
                    {
                        Ok(child) => {
                            log::info!("kent-server started (pid {})", child.id());
                            *server_setup.lock().unwrap() = Some(child);
                        }
                        Err(e) => {
                            log::error!("Failed to start kent-server: {e}");
                        }
                    }

                    let config_path = std::env::var("HOME")
                        .map(|h| std::path::PathBuf::from(h).join(".kent").join("config.json"))
                        .unwrap_or_default();
                    if config_path.exists() {
                        log::info!("Starting kent-daemon from {:?}", daemon_bin);
                        match Command::new(&daemon_bin)
                            .env("KENT_AGENT_BIN", &agent_bin)
                            .env("KENT_PROMPTS_DIR", &prompts_dir)
                            .spawn()
                        {
                            Ok(child) => {
                                log::info!("kent-daemon started (pid {})", child.id());
                                *daemon_setup.lock().unwrap() = Some(child);
                            }
                            Err(e) => log::error!("Failed to start kent-daemon: {e}"),
                        }
                    } else {
                        log::info!("No config.json found — skipping daemon (setup wizard will handle)");
                    }
                }

                let server_ready = already_running
                    || wait_for_server(Duration::from_secs(30));

                if let Some(window) = handle.get_webview_window("main") {
                    if server_ready {
                        let _ = window.eval(
                            "window.location.replace('http://localhost:19456')",
                        );
                    } else {
                        log::error!(
                            "kent-server failed to become ready within 30s"
                        );
                        let _ = window.eval(
                            "document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#888;flex-direction:column;gap:12px\"><h2 style=\"margin:0\">Kent failed to start</h2><p style=\"margin:0\">Try restarting the app or running <code>kent init</code> in your terminal.</p></div>'",
                        );
                    }
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
