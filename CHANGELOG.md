# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Encuadre: el inspector ya no extrae un JPEG con FFmpeg en cada `timeupdate`
  (ni con la pestaña oculta). Eso saturaba el backend en macOS/Safari y
  mostraba «No se pudo conectar con el backend local».
- Calcular tracking usa el timeout largo (3 min). Las extracciones de fotograma
  tienen tope y no se apilan en paralelo.
- Editor de Reel: definir un corte ya no para la reproducción ni salta al
  primer fragmento. El visor mantiene el playhead en el clip editado.
- Recortar un fragmento deja de lanzar validaciones de coherencia en cada
  movimiento (debounce + cancelación). Eso evitaba el error «La solicitud
  tardó demasiado o se canceló» y un preview congelado.
- Analizar cortes técnicos usa el timeout largo (3 min) y FFmpeg
  silencedetect ya no puede colgarse sin límite.

## [0.4.11] — 2026-08-17

### Fixed

- Vista previa NLE: la capa de subtítulos ya no bloquea clic derecho ni clics
  fuera del texto cuando el visor está agrandado; solo captura eventos en modo
  interactivo (pestaña Subtítulos).
- Splitter horizontal de timeline corregido (arrastrar hacia arriba agranda el
  visor).
- Captura de puntero liberada al soltar overlays y regla del monitor Fuente.
- Videos con controles nativos (predicación, transcripción, reparar audio,
  export): sin pantalla completa/PiP del reproductor que bloqueaba la app en
  Tauri.

## [0.4.10] — 2026-08-17

### Changed

- Visor 9:16 más grande: timeline ~38% máx., workspace 1.8×, inspector
  340px por defecto. Subtítulos del preview escalan con `subtitle_font_size`
  sobre el frame (`container-type` en el stage). Overlays de texto usan `cqh`.
- Reloj de salida unificado: `resolvePreviewSeek`, transporte y scrub usan
  `buildOutputClock` (xfade incluido). Identidad de preview incluye cortes y
  transiciones.
- Audio preview: pista separada vía `/media/audio` con offset A/V; sync de
  música con rAF y resync forzado tras cortes A/B; BGM en preview ensamblado.
- Transiciones: uniones alineadas al `outputStart` del clip siguiente;
  diamantes arrastrables; reorden optimista de clips en timeline.
- Exportar: panel muestra coherencia editorial; con unión **blocked** se puede
  exportar tras marcar «Entiendo el riesgo» (`acknowledge_coherence`). Flush
  incluye volumen música, offset A/V y captions vacíos antes de export/ensamblado.

### Fixed

- Banda gris vacía bajo las pistas de la timeline (slot `fit-content`).
- Audio trabado en crossfades por desalineación transport/seek vs reloj lógico.

## [0.4.9] — 2026-08-15

### Changed

- Pestañas del proyecto (Proyecto, Audio, Predicación, Transcripción, IA,
  Editor) viven en la barra lateral. El visor e inspector ganan altura; la
  línea temporal ocupa ~40% del editor. Subtítulos del preview abajo y
  pequeños (`cqh`). Transiciones se arrastran a las uniones de clips.
  Subtítulos en pista propia (mover/recortar independiente del video).

### Fixed

- El export no guardaba recortes/overlays pendientes (debounce 300 ms).
  Ahora vacía cortes, overlays y textos de fragmento antes de renderizar.

## [0.4.8] — 2026-08-15

### Changed

- Editor NLE tipo CapCut/Pinnacle: el visor **Programa** (9:16) es el héroe;
  el transporte y la mezcla viven en un dock a todo el ancho debajo, no
  dentro de la columna del preview. Por defecto un solo visor; Fuente es
  opcional y queda en una columna estrecha. Cromo de pestañas compacto.

### Fixed

- El 9:16 salía como miniatura porque play/mezcla le quitaban la altura.
- El audio se trababa en cada corte: la vista lógica ya no pausa ni espera
  el `seeked`. Los clips contiguos siguen; los saltos usan un visor A/B
  precargado y un temporizador de corte (no `timeupdate` tardío).

## [0.4.7] — 2026-08-15

### Fixed

- Visor Programa 9:16 se contenía mal (`height: 52vh`) y se superponía al
  inspector. El grid ahora encaja Fuente/Programa/baúl/inspector sin
  desbordar. El preview usa el encuadre elegido (`cover` en recorte,
  `contain` con letterbox en fondo desenfocado).

### Changed

- Inspector de Cortes más ancho por defecto; botones en fila. Layout NLE
  se reinicia (clave `layout.v2`) para salir de tamaños rotos.

## [0.4.6] — 2026-08-15

### Changed

- Proyecto, alta de predicación y editor NLE usan el mismo cromo (barra,
  lateral, acento oro). Pestañas de Cortes con iconos; visor con play/pausa
  claro. El editor a pantalla completa deja de pelear con el encabezado.

### Fixed

- Brace extra en el CSS del baúl que invalidaba estilos siguientes.
- Barra de progreso con `role="progressbar"` y valores ARIA.
- Contraste de textos secundarios.

## [0.4.5] — 2026-08-15

### Changed

- Inspector de Cortes extraído (`ClipInspector`, filmstrip, huecos omitidos,
  formulario de fragmento). El panel muestra tiempos de fuente y de programa.

## [0.4.4] — 2026-08-15

### Added

- Workspace NLE flexible: baúl, inspector y línea temporal se redimensionan
  (se guarda el tamaño). Visores **Fuente** (sermón 16:9 + regla de clips) y
  **Programa** (aspecto de salida). Overlays se arrastran sobre el visor.

### Changed

- Inspector de overlay extraído (`OverlayInspector`) con posición X/Y.

## [0.4.3] — 2026-08-15

### Added

- Pista B-roll de video: el baúl acepta clips (MP4/MOV/MKV/WebM), se sueltan
  sobre la línea temporal y se componen en el export (FFmpeg `overlay`, sin
  audio del B-roll). Preview lógico con `<video>` sincronizado al reloj.

### Fixed

- API de assets y overlays que el editor 0.4.1 ya llamaba pero el backend no
  exponía; las transiciones `fade` / `flash` ahora existen también en el enum
  del servidor y en el grafo `xfade`.

## [0.4.2] — 2026-08-15

### Added

- NLE a pantalla completa en el editor: monitor extraído (`PreviewMonitor`),
  atajos Espacio/J/K/L e I/O, recorte ripple que no solapa vecinos, y huecos
  del sermón como clips omitidos seleccionables.

### Changed

- La revisión de unión vive en Cortes; Exportar es solo el job MP4 y no espera
  a validar. Sondas de audio/plano opt-in.
- Workspace del editor sin cabecera de proyecto; inspector más estrecho.

### Fixed

- Visor 9:16 con `object-fit: contain` (deja de estirar el 16:9).
- Clips de la línea temporal separados; la cama de música no busca en cada corte.
- `app_version` del API alineado a la versión del paquete.

## [0.4.1] — 2026-08-15

### Added

- NLE de cultos: baúl de medios del proyecto, pista de overlays (imagen/texto),
  arrastre/reorden/trim en la línea temporal, zoom de timeline y preview DOM
  de overlays sincronizado al reloj de salida.
- Transiciones `fade` (difuminar) y `flash` (destello) además de fundido cruzado
  y a negro; picker en Cortes; grafo FFmpeg con `xfade`.
- Preview ensamblado on-demand (transiciones + overlays) junto a la vista lógica.
- API de assets (`/projects/{id}/assets`) y overlays (`/reels/{id}/overlays`).

### Changed

- Reloj de salida unificado (FE/BE) con solapes xfade; la strip ya no usa solo
  la suma de ventanas fuente.
- Persistencia optimista con debounce al arrastrar/recortar (menos jank).
- Workspace del editor: baúl | vista previa | inspector.

### Fixed

- Edición de subtítulo por fragmento unificada (`transcript_text` → burn-in).
- Escritorio: la migración de overlays (`f6a7b8c9d0e1`) ramificaba Alembic, así
  que la SQLite persistente no aplicaba `source_kind` y WebKit mostraba
  «Load failed» al listar o crear proyectos.

## [0.3.29] — 2026-08-14

### Changed

- Editor de Reel reequilibrado: panel de Cortes mucho más amplio, filmstrip de
  fragmentos, textarea y tiempos usables; línea temporal más alta y legible
  (pistas Video/Subs/Música, cursor ámbar).

## [0.3.28] — 2026-08-14

### Fixed

- Subtítulos largos se dividen en varios cues/líneas por palabras completas; ya no
  se cortan con puntos suspensivos a mitad de palabra (preview y burn-in).

## [0.3.27] — 2026-08-14

### Fixed

- Mezcla de audio usable: sliders de voz/música a ancho completo; el de música
  responde al arrastre, desilencia al ajustar y guarda con debounce.
- Línea temporal tipo NLE: cursor arrastrable, clic/arrastre en cualquier pista
  para ubicar la reproducción (ya no salta solo al inicio del clip).

## [0.3.26] — 2026-08-14

### Changed

- Editor de Reel con chrome tipo NLE: vista previa + inspector + línea temporal
  de 3 pistas (video, subtítulos, música) clicable, sin arrastre todavía.

### Fixed

- Controles de volumen estables en la barra de transporte.
- Exportación: aviso accionable cuando la coherencia bloquea el render (“Ir a Cortes”).
- Subtítulo editable del fragmento seleccionado (una sola caja, no una lista monstruosa).

## [0.3.25] — 2026-08-14

### Fixed

- Los subtítulos editados del fragmento se aplican en la exportación (burn-in):
  el texto guardado es la fuente de verdad, se fuerza el guardado de borradores
  antes de exportar, y el render vuelve a cargar los segmentos del Reel.

## [0.3.24] — 2026-08-14

### Fixed

- El preview del Reel muestra la vista final en 9:16 / 1:1 / 16:9 (antes el
  video fuente llenaba el ancho y el vertical no se veía).
- La música de fondo ya no se detiene en cada salto entre fragmentos: sigue el
  reloj del Reel y se reanuda tras los seeks.

## [0.3.23] — 2026-08-14

### Fixed

- Caja de subtítulos del fragmento ya no aparece contraída (el CSS apuntaba a
  una clase mal escrita y no se aplicaba).
- Controles de volumen de voz/música usables: fila propia, más anchos, y el
  slider de voz ya no se queda trabado en silencio.

## [0.3.22] — 2026-08-14

### Fixed

- El subtítulo del fragmento ya no se borra al ajustar inicio/fin (eso hacía
  parecer que nunca se guardaba y se perdía el avance).
- El texto guardado del corte es siempre la fuente de verdad en preview y export.
- Guardado al salir del campo de subtítulo; los tiempos del fragmento solo se
  envían al terminar de editarlos (no en cada tecla).

## [0.3.21] — 2026-08-14

### Fixed

- Guardar el subtítulo de un fragmento ahora persiste de verdad: el texto
  editado es la fuente de verdad del corte, se comprueba al guardar, alimenta
  la vista previa y ya no se descarta por heurísticas del builder.

## [0.3.20] — 2026-08-14

### Added

- Al añadir otro fragmento se elige el pedazo con tiempo de inicio y fin
  (también desde el tiempo actual del preview).

### Fixed

- El texto de subtítulos ya no se repite en todos los fragmentos: cada corte
  guarda su propio caption, no reescribe la transcripción del proyecto, y un
  texto largo heredado de Whisper no se vuelve a empaquetar en cada corte.
- Al ajustar inicio/fin de un fragmento se invalida el caption heredado para
  volver a usar las palabras del video en esa ventana.

## [0.3.19] — 2026-08-14

### Fixed

- Editar el texto de un fragmento del Reel ya no reescribe toda la
  transcripción compartida ni deja el resto de cortes sin subtítulos: cada
  fragmento guarda su propio texto y solo actualiza el segmento Whisper si
  cabe casi por completo en ese corte.

## [0.3.18] — 2026-08-14

### Fixed

- Al editar subtítulos desde un fragmento del Reel (borrar o añadir palabras),
  el texto completo vuelve a mostrarse: las palabras se reubican en el corte y
  el builder de subtítulos usa el texto guardado si los tiempos no cubren el
  fragmento.

## [0.3.17] — 2026-08-14

### Added

- Posición del texto de la pantalla final (arriba / centro / abajo).
- Transición visible en cada salto entre fragmentos (corte duro, fundido corto
  o fundido a negro).
- La música de fondo se escucha en el preview del Reel, con control de volumen
  de voz y de música.

### Fixed

- Al acortar el texto de un fragmento para subtítulos, se conservan los tiempos
  de las palabras que quedan (ya no desaparece parte del subtítulo).

## [0.3.16] — 2026-08-14

### Added

- Se puede cambiar o subir de nuevo la portada del proyecto (pantalla final y
  ficha del proyecto) después de crearlo.

## [0.3.15] — 2026-08-14

### Added

- En el editor de Reel se puede corregir el texto de transcripción de cada
  fragmento (segmentos solapados) sin volver a la pestaña de transcripción.

### Fixed

- Los subtítulos del preview del Reel ya no muestran la primera frase cuando
  no hay habla (silencio o entre fragmentos).

## [0.3.14] — 2026-08-14

### Fixed

- Preview de Reels con varios cortes: imagen y audio van en el mismo video
  (sin segundo elemento que busca aparte), así el salto al siguiente fragmento
  y pausar/reanudar ya no dejan silencios ni video congelado.

## [0.3.13] — 2026-08-14

### Fixed

- El recorte de predicación y la alineación A/V ya no re-codifican el AAC por
  diferencias normales de frames: se copia el bitstream original; solo se
  re-encodea audio (320k) como último recurso ante un desfase grande.

## [0.3.12] — 2026-08-14

### Fixed

- El preview del editor de Reel vuelve a reproducir fragmentos: usa el video de
  trabajo para imagen y audio (sin esperar la extracción `/media/audio`).

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
