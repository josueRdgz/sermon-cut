# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Reparación de audio: ya no trata micro-pausas naturales como dropouts ni
  espeja voz vecina (eco/doble). Sólo actúa en cortes digitales con bordes
  duros y suaviza el hueco con fade a silencio.

## [0.3.2] — 2026-08-05

### Changed

- Auto-reparación de microcortes hasta 200 ms por defecto (antes ~60–80 ms).

## [0.3.1] — 2026-08-05

### Added

- Reparación local y conservadora de microcortes: detecta huecos digitales
  breves rodeados de señal, reconstruye sólo los casos seguros, marca pérdidas
  largas para revisión y genera una copia del video sin modificar el original.
- Nueva sección «Reparar audio» con progreso persistente, cancelación,
  comparación A/B, lista de incidencias y descarga del video reparado.
- Opción «Aceptar y reparar todo» para reconstruir también los microcortes
  marcados para revisión (hasta el umbral de revisión).

## [0.3.0] — 2026-08-03

### Added

- Video Highlights horizontal con detección y confirmación del intervalo de la
  predicación, selección semántica, revisión editorial, metadatos estratégicos,
  subtítulos opcionales y exportación FFmpeg.
- Tipos de proyecto para Shorts, Video Highlights o ambos.
- Persistencia de la transcripción original y corregida, rango de predicación,
  fragmentos, configuración de exportación, metadatos e historial de
  regeneraciones.
- Cinco variantes de título, descripción, texto para miniatura, hashtags y
  palabras clave para Shorts y Video Highlights.

## [0.2.0] — 2026-07-30

### Added

- Desktop Gemini persistence: `scripts/seed-desktop-env.sh` + Tauri first-run
  migration into `~/Library/Application Support/app.sermoncut.desktop/.env`
  (mode `0600`, never overwrite, never log the key).
- Professional dark home screen redesign (DaVinci/OBS/Cursor aesthetic):
  `AppLayout` + `TopBar` + `Sidebar` + `StatusBar`, Inter Variable typography,
  lucide-react icons, CSS Modules design system (`PrimaryButton`,
  `StatusIndicator`, `ProjectCard`, `EmptyState`, `MetricCard`, …). Health
  endpoint now reports Whisper/Gemini availability, app version and storage
  usage; covers are served via `/api/projects/{id}/media/cover`.
- Optional YouTube import via `yt-dlp` (opt-in). Local file upload remains the
  primary, stable path. Validates the URL + domain, previews via
  `--dump-single-json`, downloads a single video (H.264/AAC MP4, default 1080p,
  never 4K), merges, verifies with FFprobe, and registers it as the project
  video. Real cancellation, structured progress, SSRF/domain guards,
  `--no-playlist`, duration/size/disk limits, and a rights-acceptance notice.
  New endpoints under `/api/youtube*`; `doctor` now checks yt-dlp + JS runtime.
- Tauri 2 desktop shell (local FastAPI on `127.0.0.1`, system FFmpeg).
- `docs/PRIVACY.md`, `docs/LICENSING.md`, `docs/DESKTOP.md`, `docs/PENDING.md`.
- Startup reconciliation of orphaned render/transcription/analysis jobs.
- SQLite `foreign_keys=ON`, WAL, and `busy_timeout`.
- Pastoral / privacy disclaimers in export and Gemini UI.
- Frontend `ErrorBoundary` and Escape/focus on confirm dialogs.

### Fixed

- Transcript timing edits no longer freeze the UI: finite validation, Spanish
  errors, transactional neighbor boundary adjust, word-timestamp remap, fetch
  timeouts, and double-save guards.
- Project status no longer flips to completed/failed while sibling renders run.
- Whisper audio extract respects cancel (terminates FFmpeg).
- Render cancel checked through verify/finalize.
- ASS karaoke encodes pauses between words; crossfade cues no longer double-stack.
- Subtitle / end-card font candidates for Windows and Linux.
- README claim of missing subtitles/end card; “100% local” wording clarified.
- Separate size limits for cover/logo/music uploads; magic-byte sniffing.
- Render reports and reveal responses no longer expose absolute filesystem paths.
- x264 `-preset` values whitelisted.

### Changed

- Cross-platform setup scripts (`scripts/setup-macos.sh`, `setup-linux.sh`,
  `setup-windows.ps1`) and start scripts for backend/frontend.
- `python -m app.cli doctor` diagnostics (Python/Node/npm/FFmpeg/FFprobe,
  permissions, SQLite, disk, Gemini, Whisper).
- Configurable storage root (`SERMON_CUT_STORAGE_DIR`) and safe auto-migrations
  on API startup.
- Export profiles (YouTube Shorts, Facebook/Instagram Reels, WhatsApp Status),
  size estimates, SHA-256, FFprobe verification, JSON reports.
- Optional local background music with ducking and loudness controls.
- Demo CC0 sample clip + transcript under `demo/`.
- Community files: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue/PR templates,
  GitHub Actions CI.
- README targets macOS, Windows, and Linux (still no Docker requirement).
- FastAPI app version now follows `SERMON_CUT` / `Settings.app_version`.

## [0.1.0] — 2026-07-24

### Added

- Local projects, transcripts (SRT/VTT/JSON/TXT), faster-whisper transcription.
- Multi-segment Reels, FFmpeg render, ASS subtitles, mandatory Pillow end cards.
- Optional Gemini editorial analysis (mock fallback), join coherence, cut
  suggestions, vertical subject tracking.
- MIT license.
