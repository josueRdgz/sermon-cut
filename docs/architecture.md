# Arquitectura de Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir videos de
predicaciones en Shorts / Reels verticales con subtítulos y una pantalla final.

> Gestión local de proyectos, transcripciones (importadas o generadas con
> faster-whisper), Reels formados por fragmentos no consecutivos, render FFmpeg
> con subtítulos ASS y pantalla final, y **análisis editorial opcional**
> (Gemini o mock). Los candidatos de IA nunca se renderizan solos: el usuario
> debe aceptarlos.

## Visión general

```
┌────────────────┐        HTTP (localhost)        ┌────────────────────┐
│  Frontend      │  ───────────────────────────►  │  Backend           │
│  React + Vite  │                                │  FastAPI           │
│  (puerto 5173) │  ◄───────────────────────────  │  (puerto 8000)     │
└────────────────┘         /api/*                  └─────────┬──────────┘
                                                             │
                                          ┌──────────────────┼───────────────────┐
                                          │                  │                   │
                                    SQLAlchemy 2        FFmpeg/FFprobe     storage/projects/
                                    + Alembic            (del sistema)       {uuid}/
                                          │
                                     SQLite (solo metadatos)
```

## Backend (`backend/`)

Organización por capas para separar responsabilidades:

- **`app/api/`** — routers de FastAPI (`health`, `projects`).
- **`app/core/`** — configuración (`config.py`), rutas (`paths.py`), excepciones
  estructuradas (`exceptions.py`).
- **`app/db/`** — `Base` declarativa (SQLAlchemy 2), `engine` y `SessionLocal`.
- **`app/models/`** — modelos ORM (`Project`, `Transcript*`, `TranscriptionJob`,
  `AnalysisJob` / `AnalysisCandidate`, `Reel` / `ReelSegment`, `RenderJob`,
  `EndCardSettings`).
- **`app/schemas/`** — contratos Pydantic 2.
- **`app/services/`** — lógica: FFmpeg/FFprobe, storage, proyectos, parsers de
  transcripción (SRT/VTT/JSON/TXT), validación, exportación, `whisper/`
  (dispositivo, extracción de audio, motor y administrador de trabajos),
  `ai/` (proveedores Gemini/mock), `analysis/` (chunking, validación, jobs),
  `reels/` (CRUD y validación de ventanas no contiguas), `subtitles/`,
  `endcard/`, `render/` (argumentos FFmpeg, ejecución y administrador).
- **`app/workers/`** — trabajos en segundo plano (futuros). Sin Celery ni Redis.

### Transcripción local (faster-whisper)

- `services/whisper/device.py` resuelve el dispositivo: `cuda` si hay GPU NVIDIA,
  si no `cpu`. Apple Silicon corre en CPU (Metal no soportado) con aviso claro.
- `services/whisper/audio.py` extrae audio a WAV mono 16 kHz con FFmpeg.
- `services/whisper/engine.py` define un contrato `TranscriptionEngine` (para
  poder simularlo en tests) y su implementación real perezosa con faster-whisper.
- `services/whisper/manager.py` es un `JobManager` con `ThreadPoolExecutor`
  (un worker) y **cancelación cooperativa** vía `threading.Event`. El estado del
  trabajo (`TranscriptionJob`) se **persiste en SQLite** y el frontend lo consulta
  por *polling*. Sin Celery ni Redis.

### Transcripciones

- Modelo normalizado independiente del formato de origen:
  `Transcript` → `TranscriptSegment` → `TranscriptWord`.
- Una transcripción activa por proyecto (reemplazo al reimportar).
- TXT sin tiempos → estado `unsynced`.
- Video servido con `FileResponse` (Range) en
  `GET /api/projects/{id}/media/video` para el `<video>` HTML5.
- Fuente `whisper` para transcripciones generadas localmente.

### Reels

- `Reel` + `ReelSegment`: un Reel es una **lista ordenada de ventanas** sobre el
  video fuente. La contigüidad **no** se exige; los huecos entre fragmentos son
  intencionales y se muestran en la UI.
- Validación en `services/reels/validate.py`: tiempos, duración mínima, límites
  del video, orden denso `0..n-1`, reglas de transición.
- **Validación de coherencia de unión** en `services/coherence/`: reglas
  deterministas (corte de palabra, conectores sueltos, finales incompletos,
  pronombres sin referente, cambio abrupto de tema, referencias huérfanas,
  pausas artificiales) más sondas opcionales de volumen/silencio/plano vía
  FFmpeg y una revisión opcional con Gemini del guion unido (JSON, sin
  reescritura). Severidades: `valid` / `warning` / `blocked`. Las advertencias
  se pueden ignorar (`coherence_dismissals_json`); los bloqueos no. El render
  se demora en UI y en servidor si quedan bloqueos activos.
- Duración total = suma de ventanas + transiciones entre fragmentos.
- API anidada bajo `/api/projects/{id}/reels`; creación auxiliar
  `/reels/from-transcript`; validación
  `POST …/reels/{reelId}/validate` (+ dismiss / expand-context).
- Frontend: `ReelEditor` con selección de transcripción, fórmula
  `A + B + C`, saltos visibles, `CoherencePanel` antes del render y vista
  previa lógica.
- **Cortes técnicos opcionales** (`services/cut_suggestions/`):
  `silencedetect`, pausas largas, reducción de silencios con margen natural,
  muletillas/repeticiones/falsos comienzos desde la transcripción (sin borrar
  usos con sentido real). Intensidades `conservative` (default) /
  `balanced` / `aggressive`. Nada se aplica sin aceptar; al aceptar se puede
  partir el fragmento con `short_crossfade` y se refresca `transcript_text`
  para que los subtítulos se recalculen. UI: `CutSuggestionsPanel` + marcadores
  en la línea de tiempo.
- **Encuadre vertical opcional** (`services/tracking/`): interfaz
  `SubjectTracker` + OpenCV local (MediaPipe opcional, no recomendado por
  peso). Muestrea fotogramas a baja frecuencia vía FFmpeg stills, interpola,
  suaviza y limita velocidad/aceleración; zona segura para subtítulos. Modos:
  `auto_track`, `center_crop`, `blurred_background`, `manual` (cuadro por
  fragmento). Caché en `storage/projects/{id}/tracking/`. El MP4 final lo
  construye FFmpeg con `crop` (expresiones); si el tracking es inestable se
  degrada a fondo desenfocado. UI: `FramingPanel` con vista previa.

### Análisis editorial (IA opcional)

- `services/ai/` define una interfaz `AIProvider` con dos implementaciones:
  `GeminiProvider` (SDK oficial `google-genai`, JSON estructurado, timeout y
  reintentos acotados) y `MockAIProvider` (determinista, sin red).
- `resolve_provider()` elige Gemini solo si hay `SERMON_CUT_GEMINI_API_KEY`; si
  no, usa el mock. La app permanece usable sin Gemini.
- `services/analysis/chunking.py` parte transcripciones largas conservando
  tiempos absolutos; `manager.py` analiza cada bloque y llama a
  `merge_candidates` como etapa final.
- `services/analysis/validate.py` es la puerta: exige evidencia de `exact_text`
  en el intervalo, ajusta a límites de palabra y rechaza intervalos ilegales o
  solapes. Las advertencias de baja confianza se muestran al usuario.
- Modelos `AnalysisJob` / `AnalysisCandidate`: los candidatos nacen en
  `pending`. Aceptar crea un Reel vía `reels_service.create_reel`; **nunca**
  dispara un render.
- Frontend: `AnalysisPanel` (preferencias, polling, aceptar/descartar).

### Subtítulos (ASS)

- `services/subtitles/timeline.py` coloca cada ventana del Reel en el reloj de
  salida (mismo criterio que FFmpeg: hard cut suma; crossfade resta el solape).
- `services/subtitles/cues.py` selecciona palabras/segmentos que solapan cada
  ventana, remapea tiempos y parte en cues (segmento / frase / palabra).
- `services/subtitles/templates.py` define las cuatro plantillas; las opciones
  del Reel (tamaño, posición, mayúsculas, etc.) se superponen al preset.
- `services/subtitles/ass.py` escribe el documento ASS; `fonts.py` resuelve
  fuentes del sistema y las prepara en `fontsdir` (sin descargas).
- El render añade `[v]ass=…:fontsdir=…[vout]` al `filter_complex` y mapea
  `[vout]`.
- Frontend: `SubtitlePanel` personaliza el Reel y proyecta la vista previa sobre
  el reproductor; `RenderPanel` puede activar/desactivar el quemado.

### Pantalla final (obligatoria)

- `models/end_card.py` guarda `EndCardSettings`. La fila con `project_id IS NULL`
  son los valores globales; una fila con `project_id` los sobrescribe. La
  resolución es `proyecto → global → constantes`, así que un proyecto siempre
  tiene configuración usable: la pantalla no es opcional.
- `services/endcard/layout.py` es **geometría pura** (zonas seguras, wrap,
  reducción de fuente, recorte con «…», clamp de duración a 3–8 s). Recibe la
  función que mide el ancho del texto, así que se testea con métricas
  deterministas en lugar de fuentes reales.
- `services/endcard/image.py` compone con **Pillow** un PNG deliberadamente
  simple: portada y un único mensaje editable debajo.
- `services/endcard/service.py` resuelve/persiste la configuración y guarda los
  archivos que aporta el usuario (logo, música) dentro de la carpeta del proyecto.
- `services/endcard/pipeline.py` genera el PNG y devuelve un `EndCardSpec`
  silencioso para FFmpeg.
- El grafo añade la imagen como entrada `-loop 1` y hace `concat` **después** del
  filtro `ass`, de modo que los tiempos de los subtítulos siguen refiriéndose solo
  al contenido principal.
- Frontend: `EndCardPanel` muestra la vista previa y solo permite editar el
  mensaje inferior.

### Música de fondo (opcional)

- `services/background_music/` guarda un archivo local del usuario
  (`background-music.<ext>`) y genera el grafo FFmpeg: preparación del bed,
  ducking con `sidechaincompress`, `amix` priorizando voz, `alimiter` y
  `loudnorm` (LUFS configurable, por defecto −16). Preset por defecto: `none`.
- La pista se mezcla en la línea principal y, si termina, se rellena con silencio
  en vez de repetirla.
- Frontend: `BackgroundMusicPanel` abre la Biblioteca de audio de YouTube Studio
  y permite seleccionar el MP3 descargado, con advertencia de atribución.

### Perfiles de exportación

- `services/export_profiles/` define perfiles editables (YouTube Shorts, Facebook /
  Instagram Reels, WhatsApp Status), estimación de tamaño, naming seguro,
  verificación FFprobe, hash SHA-256, reporte JSON y «abrir carpeta» multiplataforma.
- El `RenderManager` aplica CRF/preset/bitrate del perfil, fuerza el lienzo
  1080×1920, ajusta márgenes de subtítulos a la safe area y **no publica** nada
  automáticamente (`publish_status=local_only`).
- Frontend: selector de perfil/calidad/CRF, estimación, historial y revelar carpeta
  en `RenderPanel`.

### Render (FFmpeg)

- `services/render/args.py` es una función **pura**: recibe las ventanas, el
  aspecto y el encuadre y devuelve un `RenderPlan` con la lista explícita de
  argumentos, el `filter_complex` y la duración esperada. Al no ejecutar nada, se
  puede testear a fondo sin tocar disco ni FFmpeg.
- El grafo normaliza cada fragmento (resolución, FPS constante, `yuv420p`, audio
  estéreo 48 kHz) **antes** de unirlos, requisito para que `concat` y `xfade`
  funcionen con ventanas arbitrarias. Los cortes son precisos porque cada
  fragmento se recodifica tras un `-accurate_seek`; nunca se usa solo `-c copy`.
- Los empalmes llevan un fade de audio de ~15 ms. Las transiciones con fundido
  usan `xfade` + `acrossfade` con **idéntica duración**, de modo que audio y
  video se acortan por igual y la sincronía se conserva.
- `services/render/progress.py` acumula los pares `key=value` de
  `-progress pipe:1` y emite una actualización por bloque (`progress=continue`).
- `services/render/runner.py` ejecuta `subprocess.Popen` con la lista de
  argumentos (nunca `shell=True`), envía `stderr` a un log para no bloquear la
  tubería y termina el proceso cuando se solicita cancelación.
- `services/render/manager.py` replica el patrón del `JobManager` de whisper:
  `ThreadPoolExecutor` de un worker, estado en SQLite (`RenderJob`) para
  *polling*, y limpieza de temporales. Consulta FFprobe para saber si el origen
  tiene audio y a qué FPS venía. Los temporales viven dentro de la carpeta del
  proyecto y la salida se coloca en `renders/` con un nombre libre, sin
  sobrescribir nada.
- El comando saneado (`shlex.join`) se registra en el log y se guarda en el
  trabajo para depuración.
- Frontend: `RenderPanel` (dentro de `ReelEditor`) elige aspecto/encuadre, hace
  polling del progreso y, al terminar, reproduce el MP4 vía
  `GET /api/render-jobs/{id}/output` y ofrece descarga.

- Metadatos en SQLite; video y portada en `storage/projects/{uuid}/`.
- Nombres canónicos en disco: `original.<ext>`, `cover.<ext>`.
- Subida con validación de extensión/MIME, límite `SERMON_CUT_MAX_UPLOAD_BYTES`,
  saneado de nombres y bloqueo de path traversal.
- Tras subir el video, FFprobe rellena duración, resolución, FPS y códecs.
- Al borrar un proyecto se elimina también su carpeta local.

### Migraciones

Alembic lee la URL y el `metadata` desde la app (`alembic/env.py`), con
`render_as_batch=True` para SQLite.

## Frontend (`frontend/`)

- **`src/api/`** — cliente HTTP (`client.ts`) con JSON + subidas con progreso (XHR).
- **`src/types/`** — tipos que reflejan los schemas del backend.
- **`src/hooks/`** — `useHealth`, `useProjects`.
- **`src/pages/`** — inicio, listado, nueva predicación, detalle.
- **`src/components/`** — tarjetas, diálogo de confirmación, barra de progreso.
- **`src/utils/`** — formato de duración/fecha/estado.
- Rutas con **react-router-dom**.

En desarrollo, Vite hace *proxy* de `/api` hacia `http://127.0.0.1:8000`.

## Almacenamiento (`storage/`)

- `projects/{uuid}/` — media de cada proyecto.
- `projects/{uuid}/renders/` — Reels renderizados (MP4), con `.tmp/` para los
  archivos intermedios de FFmpeg.
- `temp/` — archivos intermedios de transcripción.
- `exports/` — videos exportados (futuro).

Las carpetas se versionan vacías (`.gitkeep`); su contenido está en `.gitignore`.

## Principios

- Plataformas objetivo: **macOS, Windows y Linux**.
- Ejecución **local-first**; sin servicios externos *obligatorios*. Gemini y la
  descarga de modelos Whisper son opcionales (ver [PRIVACY.md](PRIVACY.md)).
- Sin **Celery** ni **Redis**.
- Rutas siempre con **`pathlib`**, nunca concatenando strings.
- Sin blobs binarios en SQLite.
- Dependencias mínimas y justificadas. FFmpeg del sistema: [LICENSING.md](LICENSING.md).
