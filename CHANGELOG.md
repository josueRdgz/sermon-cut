# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.11] — 2026-08-14

### Fixed

- El análisis y la edición ya no estiran ni reusan audio reparado viejo: el
  preview y el export copian el habla del video de trabajo. Si un recorte o
  mux del programa deja imagen y sonido desfasados, se realinean solos.

## [0.3.10] — 2026-08-14

### Fixed

- Tras recortar la predicación, transcripción, Reels, Highlights y el audio de
  vista previa usan solo el video recortado (se descartan tiempos y caches del
  culto completo).

## [0.3.9] — 2026-08-14

### Added

- En un proyecto nuevo, iglesia y canal salen rellenados (Gethsemaní /
  @iprm.gethsemani) y la URL de YouTube es también el enlace del sermón.
- Se elige si el video es el culto completo o solo el sermón.
- Pestaña Predicación: reproductor y recorte de inicio/final; ese tramo queda
  como video de trabajo para transcribir y editar.

## [0.3.8] — 2026-08-13

### Added

- Preview ensamblado de Video Highlights (MP4 con imagen y audio) para que
  Play no dependa del video fuente completo.
- Estilo editorial de iglesia en redes (gancho, una idea, frase memorable y
  aplicación) para Reels y Highlights, con presets en la UI.
- Pestañas internas de Highlights (detección, análisis, revisión, título,
  pantalla final, audio, exportar) y barra de proyecto siempre visible al
  hacer scroll.

### Changed

- La compactación de transcripción prioriza frases citables y aplicaciones
  antes de recortar por longitud.
- Duración por defecto de Reels: 25–45 s.

## [0.3.7] — 2026-08-06

### Fixed

- El editor de reel usa el audio reparado tras «Usar audio reparado en el proyecto».
- Puente de reparación sin saturación (±32767) en huecos largos; min dropout 1 ms.
- Comparación A/B con WAV seekable; video remux con faststart; descargas en Tauri.

## [0.3.6] — 2026-08-06

### Fixed

- Detección de microcortes en audio real (AAC→WAV estéreo): umbral 96, media
  entre canales, núcleo ajustado al suelo residual y puente Hermite para
  eliminar el corte (sin dejar silencio ni espejar frases enteras).

## [0.3.5] — 2026-08-06

### Fixed

- Reparación de microcortes: el hueco se puentea con smoothstep entre los
  bordes reales (elimina el corte audible). Ya no se deja silencio en el
  medio ni se espeja un tramo largo de voz.

## [0.3.4] — 2026-08-06

### Fixed

- Detección de microcortes demasiado estricta: umbral de silencio 32 (suelo AAC),
  contexto 160 RMS, bordes en ~1 ms y pico mínimo 120, sin tragar micro-pausas
  naturales. Sigue sin espejar voz al reparar.

## [0.3.3] — 2026-08-06

### Fixed

- Reparación de audio: ya no trata micro-pausas naturales como dropouts ni
  espeja voz vecina (eco/doble). Sólo actúa en cortes digitales con bordes
  duros.
- Huecos cortos se interpolan; los largos sólo suavizan ~2.5 ms en cada borde
  hacia silencio real (sin alargar el fonema del corte, que sonaba a tartamudeo).
- El build de escritorio en macOS genera sólo el DMG y no deja un `.app`
  suelto en el repo (evita duplicados en el selector / iCloud).

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
