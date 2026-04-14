use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

type ChildHandle = Arc<Mutex<Option<Child>>>;

/// Wait until `/api/health` responds with a 200 — not just until TCP connects.
/// Ensures the server can actually handle requests before we load the webview.
fn wait_for_server(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if health_check_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

/// Probe `/api/health`. Returns true iff the server on port 19456 is actually
/// Kent's kent-server AND its bundled static dir exists. Anything else (no
/// listener, stale server from a previous install, wrong app squatting on the
/// port) returns false so the caller knows to kill-and-respawn.
fn health_check_ok() -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:19456".parse().unwrap(),
        Duration::from_millis(500),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    if stream
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = Vec::with_capacity(2048);
    let _ = stream.read_to_end(&mut buf);
    let body = String::from_utf8_lossy(&buf);
    // Server must self-identify as kent-server AND have a usable static dir.
    // `"staticExists":false` = stale server pointing at a deleted path.
    body.contains("HTTP/1.1 200")
        && body.contains("\"app\":\"kent-server\"")
        && body.contains("\"staticExists\":true")
}

/// Unload any stale launchd agents registered by a previous CLI-based install.
/// The old architecture used `sh.kent.web` + `sh.kent.daemon` plists with
/// KeepAlive=true, which fight with the Tauri shell — every time Tauri kills
/// a child, launchd instantly respawns it, and Tauri ends up reusing the
/// stale server. Since the bundled Kent.app now manages these processes
/// directly, we unconditionally unload + delete the plists at startup.
fn evict_legacy_launchd_agents() {
    // Resolve current UID via `id -u` (avoids pulling in libc as a dep).
    let uid = Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if uid.is_empty() {
        return;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let agents = ["sh.kent.web", "sh.kent.daemon"];
    for name in agents {
        let target = format!("gui/{uid}/{name}");
        let out = Command::new("/bin/launchctl")
            .args(["bootout", &target])
            .output();
        if out.is_ok() {
            log::info!("Evicted legacy launchd agent {name} (gui/{uid})");
        }
        let plist_path = format!("{home}/Library/LaunchAgents/{name}.plist");
        let _ = std::fs::remove_file(&plist_path);
    }
}

/// Kill any process listening on port 19456. Used when the health check fails
/// because a stale kent-server from a previous Kent.app install is squatting.
/// Shells out to `lsof` because it's the only reliable way from pure Rust
/// without adding a dependency.
fn kill_port_squatter(port: u16) {
    // lsof -ti tcp:PORT -sTCP:LISTEN → PIDs of processes listening
    let Ok(output) = Command::new("/usr/sbin/lsof")
        .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
        .output()
    else {
        return;
    };
    let pids = String::from_utf8_lossy(&output.stdout);
    for line in pids.lines() {
        let Ok(pid) = line.trim().parse::<i32>() else { continue };
        log::info!("Killing stale process on port {port}: pid {pid}");
        let _ = Command::new("/bin/kill").args(["-9", &pid.to_string()]).status();
    }
    // Give the OS a moment to release the socket before we rebind.
    std::thread::sleep(Duration::from_millis(500));
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
                // Vestigial launchd agents from a previous CLI-based install
                // will auto-respawn old sidecars and compete with us. Evict
                // them before doing anything else so the port is actually free.
                evict_legacy_launchd_agents();

                // Instead of a naive TCP check, actually probe /api/health.
                // Anything else squatting on 19456 (stale kent-server from a
                // previous install, unrelated process) gets killed and we
                // respawn a fresh one below.
                let healthy = health_check_ok();
                let port_busy = TcpStream::connect_timeout(
                    &"127.0.0.1:19456".parse().unwrap(),
                    Duration::from_millis(200),
                )
                .is_ok();

                let already_running = if healthy {
                    log::info!("kent-server already running and healthy on port 19456, reusing");
                    true
                } else if port_busy {
                    log::warn!("port 19456 is busy but /api/health failed — killing squatter");
                    kill_port_squatter(19456);
                    false
                } else {
                    false
                };

                if !already_running {
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
                        // Tell kent-server where the bundled daemon + agent binaries
                        // live so it can spawn them directly in response to
                        // /api/daemon/start without going through the TS CLI.
                        .env("KENT_DAEMON_BIN", &daemon_bin)
                        .env("KENT_AGENT_BIN", &agent_bin)
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
