# Empaquetado de escritorio (Tauri 2)

## Decisión

**Opción elegida: Tauri 2**, sin reescribir el backend FastAPI ni el frontend React.

### Arquitectura actual (resumen)

```
┌─────────────────┐   invoke / fetch    ┌──────────────────┐
│ Tauri WebView   │ ──────────────────► │ FastAPI (uvicorn)│
│ (React dist)    │   127.0.0.1:<port>  │ + FFmpeg sistema │
└────────┬────────┘                     │ + SQLite/storage │
         │ spawn + health               └──────────────────┘
         ▼
┌─────────────────┐
│ Host Rust       │
│ (ciclo de vida) │
└─────────────────┘
```

En desarrollo **navegador** se siguen usando dos procesos (`scripts/start-backend.*` + `start-frontend.*`).  
Esa forma **no se elimina**.

### ¿Puede Tauri hacer lo que necesitamos?

| Necesidad | ¿Tauri 2? | Cómo |
|-----------|-----------|------|
| Iniciar FastAPI local | Sí | El host Rust arranca `uvicorn` en un puerto libre de `127.0.0.1` |
| Abrir el frontend en una ventana | Sí | WebView del sistema carga Vite (dev) o el `dist/` (release) |
| Detener el backend al cerrar | Sí | Al salir se hace `kill` del proceso hijo |
| Acceder a archivos locales | Sí | Sigue siendo el backend (uploads, `storage/`); diálogos Tauri opcionales más adelante |
| Abrir carpetas | Sí | Endpoint existente `/api/render-jobs/{id}/reveal` (Finder/Explorer/xdg-open) |
| macOS / Windows / Linux | Sí | Bundles nativos Tauri; FFmpeg **del sistema** en esta fase |

### Comparación breve

| Opción | Pros | Contras |
|--------|------|---------|
| **Tauri 2** | Ligero, webview del SO, buen empaquetado multiplataforma, no reescribe la app | Requiere Rust toolchain para *compilar*; hay que orquestar el proceso Python |
| **Electron** | Ecosistema JS maduro | Chromium embebido → binarios grandes y más RAM |
| **PyWebView** | Muy simple si todo es Python | Empaquetado/firma multiplataforma más frágil; menos control de ciclo de vida |
| **Solo navegador** | Cero empaquetado (ya funciona) | El usuario gestiona dos terminales; no hay “app” instalable |

**Conclusión:** Tauri es la opción más sencilla *y* mantenible a medio plazo: reutiliza frontend/backend tal cual, añade un host fino en Rust y mantiene los scripts de desarrollo actuales.

### Alcance de esta integración (v0)

- FastAPI **solo** en `127.0.0.1` (nunca `0.0.0.0`).
- Puerto **libre** elegido al arrancar; la UI obtiene la base URL vía `get_api_base_url`.
- Espera a `GET /api/health` antes de mostrar la ventana principal.
- Al cerrar la app se termina el proceso hijo.
- Stdout/stderr del sidecar se registran en el log de Tauri.
- **FFmpeg no se empaqueta** (licencias + tamaño): se usa el FFmpeg del PATH.
  Detalle legal: [LICENSING.md](LICENSING.md).
- **No** hay publicación automática de releases.

### Alcance del instalador local

- La compilación usa `backend/.venv`, pero el `.app` resultante incluye un
  **sidecar Python/FastAPI autónomo** generado con PyInstaller.
- Los proyectos, la base SQLite y los modelos se guardan fuera del bundle en
  `~/Library/Application Support/app.sermoncut.desktop/storage`.
- La configuración opcional (Gemini, etc.) vive en
  `~/Library/Application Support/app.sermoncut.desktop/.env` con permisos `0600`.
  Ese archivo **no** se borra al reinstalar el DMG.
- En el primer arranque (o al ejecutar `scripts/seed-desktop-env.sh` / `build-desktop.sh`),
  si el `.env` de Application Support aún no existe y el `.env` del repositorio
  contiene `SERMON_CUT_GEMINI_API_KEY`, se migran solo
  `SERMON_CUT_AI_PROVIDER`, `SERMON_CUT_GEMINI_API_KEY` y `SERMON_CUT_GEMINI_MODEL`
  sin imprimir la clave. Un `.env` persistente existente nunca se sobrescribe.
- La API key **nunca** se embebe en el `.app`, el DMG ni el JavaScript.
- FFmpeg/FFprobe siguen siendo dependencias del sistema.
- Firma y notarización de Apple aún requieren una identidad de Developer ID.

---

## Requisitos

1. Setup normal del repo (`./scripts/setup-macos.sh`, `setup-linux.sh` o `setup-windows.ps1`).
2. **FFmpeg** y **FFprobe** en el PATH del sistema.
3. **Rust** estable vía [rustup](https://rustup.rs/) (`cargo`, `rustc`).
4. En macOS: Xcode Command Line Tools (`xcode-select --install`).
5. Dependencias npm del frontend (`cd frontend && npm install`).
6. PyInstaller dentro del venv (se instala con `pip install -e ".[dev]"`).

Variables opcionales:

| Variable | Uso |
|----------|-----|
| `SERMON_CUT_PYTHON` | Interprete Python (por defecto `backend/.venv/...`) |
| `SERMON_CUT_BACKEND_DIR` | Raíz del backend (debe contener `app/main.py`) |
| `SERMON_CUT_ENV_FILE` | Archivo `.env` alternativo; el `.app` usa el de Application Support |

---

## Desarrollo en escritorio

Desde la raíz del repo:

```bash
chmod +x scripts/dev-desktop.sh   # una vez
./scripts/dev-desktop.sh
```

O:

```bash
cd frontend
npm run desktop:dev
```

Esto:

1. Arranca Vite (`beforeDevCommand`).
2. Compila el host Tauri.
3. Lanza uvicorn en `127.0.0.1:<puerto libre>`.
4. Espera `/api/health`.
5. Muestra la ventana y pasa la base URL a la UI.

### Desarrollo en navegador (sin cambios)

```bash
./scripts/start-backend.sh    # o .ps1
./scripts/start-frontend.sh   # otra terminal
```

---

## Compilación local (sin publicar)

```bash
chmod +x scripts/build-desktop.sh   # una vez
./scripts/build-desktop.sh
```

O:

```bash
cd frontend
npm run desktop:build
```

Artefactos típicos:

| SO | Ruta orientativa |
|----|------------------|
| macOS | `frontend/src-tauri/target/release/bundle/macos/Sermon Cut.app` |
| Windows | `frontend/src-tauri/target/release/bundle/msi/` o `nsis/` |
| Linux | `frontend/src-tauri/target/release/bundle/deb/` / `appimage/` |

La app resultante incluye Python, FastAPI, Whisper, Gemini, yt-dlp y las
dependencias configuradas en el venv. La Mac de destino solo necesita
FFmpeg/FFprobe. No se suben releases a GitHub desde estos scripts.

En macOS se generan normalmente:

- `bundle/macos/Sermon Cut.app`
- `bundle/dmg/Sermon Cut_0.2.0_aarch64.dmg` en Apple Silicon

Sin firma/notarización, otra Mac puede mostrar una advertencia de Gatekeeper. La
persona usuaria puede abrir la aplicación desde Finder con clic secundario →
**Abrir**. Para distribución pública se debe configurar una identidad Apple
Developer ID y notarizar el DMG.

---

## Qué no hace todavía

- Empaquetar FFmpeg dentro del instalador.
- CI que publique releases automáticamente.
- Notarización / firma de código.

---

## Código relevante

| Pieza | Ruta |
|-------|------|
| Host + ciclo de vida | `frontend/src-tauri/src/backend.rs`, `lib.rs` |
| Config Tauri | `frontend/src-tauri/tauri.conf.json` |
| Base URL en la UI | `frontend/src/api/client.ts` → `prepareApiBaseUrl()` |
