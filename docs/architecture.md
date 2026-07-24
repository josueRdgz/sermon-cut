# Arquitectura de Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir videos de
predicaciones en Shorts / Reels verticales con subtítulos y una pantalla final.

> Gestión local de proyectos, transcripciones (importadas o generadas con
> faster-whisper) y Reels formados por fragmentos no consecutivos. Todavía no
> hay Gemini, generación automática de clips ni renderizado final a archivo.

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
  `Reel` / `ReelSegment`, `RenderJob`).
- **`app/schemas/`** — contratos Pydantic 2.
- **`app/services/`** — lógica: FFmpeg/FFprobe, storage, proyectos, parsers de
  transcripción (SRT/VTT/JSON/TXT), validación, exportación, `whisper/`
  (dispositivo, extracción de audio, motor y administrador de trabajos),
  `reels/` (CRUD, validación de ventanas no contiguas, duración) y `render/`
  (generador de argumentos FFmpeg, ejecución y administrador de trabajos).
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
- Duración total = suma de ventanas + transiciones entre fragmentos.
- API anidada bajo `/api/projects/{id}/reels`; creación auxiliar
  `/reels/from-transcript`.
- Frontend: `ReelEditor` con selección de transcripción, fórmula
  `A + B + C`, saltos visibles y vista previa lógica.

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

- Plataforma objetivo: **macOS**.
- Ejecución **100% local**; sin servicios externos obligatorios.
- Sin **Celery** ni **Redis**.
- Rutas siempre con **`pathlib`**, nunca concatenando strings.
- Sin blobs binarios en SQLite.
- Dependencias mínimas y justificadas.
