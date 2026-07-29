//! Local FastAPI (uvicorn) lifecycle for the Sermon Cut desktop shell.
//!
//! Binds only to 127.0.0.1, picks a free port, waits for /api/health, and
//! terminates the child when the desktop app exits. FFmpeg is **not** bundled —
//! the backend uses whatever is on the system PATH.

use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use log::{info, warn};
use tauri::{AppHandle, Manager};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(90);
const HEALTH_POLL: Duration = Duration::from_millis(250);

pub struct BackendHandle {
    pub port: u16,
    pub api_base: String,
    child: Mutex<Option<Child>>,
}

impl BackendHandle {
    pub fn api_base_url(&self) -> String {
        self.api_base.clone()
    }

    pub fn shutdown(&self) {
        let mut guard = match self.child.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(mut child) = guard.take() {
            info!("Stopping FastAPI child (pid={:?})", child.id());
            // Best-effort graceful stop, then force-kill.
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for BackendHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Start uvicorn on 127.0.0.1:<free-port> and wait until /api/health is OK.
pub fn start_backend(app: &AppHandle) -> Result<BackendHandle, String> {
    let port = free_port()?;
    let api_base = format!("http://127.0.0.1:{port}");
    let bundled = resolve_bundled_backend(app)?;
    let (backend_dir, executable) = if let Some((directory, binary)) = bundled.as_ref() {
        (directory.clone(), binary.clone())
    } else {
        let directory = resolve_backend_dir()?;
        let python = resolve_python(&directory)?;
        (directory, python)
    };

    info!(
        "Starting FastAPI with {} in {} on {} (bundled={})",
        executable.display(),
        backend_dir.display(),
        api_base,
        bundled.is_some()
    );

    let mut cmd = Command::new(&executable);
    cmd.current_dir(&backend_dir)
        .env("SERMON_CUT_AUTO_MIGRATE", "true")
        // Desktop webview origins (in addition to defaults in Settings).
        .env(
            "SERMON_CUT_CORS_ORIGINS",
            r#"["http://localhost:5173","http://127.0.0.1:5173","tauri://localhost","https://tauri.localhost","http://tauri.localhost","https://asset.localhost","http://asset.localhost"]"#,
        );
    if bundled.is_none() {
        cmd.arg("-m").arg("uvicorn").arg("app.main:app");
    } else {
        configure_bundled_environment(app, &mut cmd)?;
    }
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        // No --reload in the desktop shell (cleaner child lifecycle).
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|err| {
        format!(
            "No se pudo iniciar el backend FastAPI ({}): {err}. \
             ¿Existe el venv? Ejecuta ./scripts/setup-macos.sh (u equivalente).",
            executable.display()
        )
    })?;

    // Drain stdout/stderr so the pipe never blocks the child.
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || pipe_to_log(stdout, false));
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || pipe_to_log(stderr, true));
    }

    if let Err(err) = wait_for_health(port) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(err);
    }

    info!("Backend healthy at {api_base}");
    Ok(BackendHandle {
        port,
        api_base,
        child: Mutex::new(Some(child)),
    })
}

fn resolve_bundled_backend(app: &AppHandle) -> Result<Option<(PathBuf, PathBuf)>, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| format!("No se pudo localizar Resources del .app: {err}"))?;
    let directory = resource_dir.join("backend");
    #[cfg(windows)]
    let executable = directory.join("sermon-cut-backend.exe");
    #[cfg(not(windows))]
    let executable = directory.join("sermon-cut-backend");

    if executable.is_file() {
        return Ok(Some((directory, executable)));
    }
    Ok(None)
}

fn configure_bundled_environment(app: &AppHandle, cmd: &mut Command) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("No se pudo localizar Application Support: {err}"))?;
    let storage = app_data.join("storage");
    std::fs::create_dir_all(&storage)
        .map_err(|err| format!("No se pudo crear {}: {err}", storage.display()))?;

    if std::env::var_os("SERMON_CUT_STORAGE_DIR").is_none() {
        cmd.env("SERMON_CUT_STORAGE_DIR", &storage);
    }
    if std::env::var_os("SERMON_CUT_ENV_FILE").is_none() {
        cmd.env("SERMON_CUT_ENV_FILE", app_data.join(".env"));
    }

    #[cfg(target_os = "macos")]
    {
        let inherited = std::env::var("PATH").unwrap_or_default();
        let path = format!(
            "/opt/homebrew/bin:/opt/homebrew/opt/ffmpeg-full/bin:/usr/local/bin:\
             /usr/local/opt/ffmpeg-full/bin:{inherited}"
        );
        cmd.env("PATH", path);
    }
    Ok(())
}

fn pipe_to_log<R: Read>(mut reader: R, is_err: bool) {
    let mut buf = [0_u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                for line in text.lines() {
                    if is_err {
                        warn!("[fastapi] {line}");
                    } else {
                        info!("[fastapi] {line}");
                    }
                }
            }
            Err(_) => break,
        }
    }
}

fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("No se pudo reservar un puerto local: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("No se pudo leer el puerto local: {e}"))?
        .port();
    // Drop listener so uvicorn can bind the same port.
    drop(listener);
    Ok(port)
}

fn wait_for_health(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let url_path = "/api/health";
    while Instant::now() < deadline {
        if health_ok(port, url_path) {
            return Ok(());
        }
        thread::sleep(HEALTH_POLL);
    }
    Err(format!(
        "El backend no respondió en {url_path} dentro de {}s (127.0.0.1:{port}). \
         Revisa logs [fastapi] y que FFmpeg/Python estén instalados.",
        HEALTH_TIMEOUT.as_secs()
    ))
}

fn health_ok(port: u16, path: &str) -> bool {
    let Ok(addr) = format!("127.0.0.1:{port}").parse() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let _ = stream.flush();
    let mut body = String::new();
    let _ = stream.read_to_string(&mut body);
    let _ = stream.shutdown(Shutdown::Both);
    let status_ok = body
        .lines()
        .next()
        .is_some_and(|line| line.contains(" 200 "));
    status_ok && body.contains("\"status\"")
}

fn resolve_backend_dir() -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var("SERMON_CUT_BACKEND_DIR") {
        let path = PathBuf::from(override_dir);
        if path.join("app").join("main.py").is_file() {
            return Ok(path);
        }
        return Err(format!(
            "SERMON_CUT_BACKEND_DIR no contiene app/main.py: {}",
            path.display()
        ));
    }

    // src-tauri/ → frontend/ → repo/backend
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest.join("../../backend"),
        manifest.join("../../../backend"),
        manifest.join("backend"),
    ];
    for candidate in candidates {
        if let Ok(resolved) = candidate.canonicalize() {
            if resolved.join("app").join("main.py").is_file() {
                return Ok(resolved);
            }
        }
    }
    Err(
        "No se encontró el directorio backend/. Define SERMON_CUT_BACKEND_DIR o ejecuta desde el repo."
            .into(),
    )
}

fn resolve_python(backend_dir: &Path) -> Result<PathBuf, String> {
    if let Ok(override_py) = std::env::var("SERMON_CUT_PYTHON") {
        let path = PathBuf::from(override_py);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "SERMON_CUT_PYTHON no es un ejecutable válido: {}",
            path.display()
        ));
    }

    #[cfg(windows)]
    let venv_python = backend_dir.join(".venv").join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let venv_python = backend_dir.join(".venv").join("bin").join("python");

    if venv_python.is_file() {
        return Ok(venv_python);
    }

    for name in ["python3", "python"] {
        if let Ok(path) = which(name) {
            warn!(
                "Usando {} del PATH (no hay venv en {}). Recomendado: scripts/setup-*.",
                path.display(),
                backend_dir.display()
            );
            return Ok(path);
        }
    }

    Err(format!(
        "No se encontró Python. Crea el venv con el script de setup o define SERMON_CUT_PYTHON. \
         Buscado: {}",
        venv_python.display()
    ))
}

fn which(cmd: &str) -> Result<PathBuf, ()> {
    let path = std::env::var_os("PATH").ok_or(())?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(cmd);
        if candidate.is_file() {
            return Ok(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{cmd}.exe"));
            if with_exe.is_file() {
                return Ok(with_exe);
            }
        }
    }
    Err(())
}
