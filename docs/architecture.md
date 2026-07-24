# Arquitectura de Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir videos de
predicaciones en Shorts / Reels verticales con subtítulos y una pantalla final.

> Gestión local de proyectos y transcripciones. Todavía no hay Gemini,
> generación de clips ni renderizado final.

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
- **`app/models/`** — modelos ORM (`Project` + `ProjectStatus`).
- **`app/schemas/`** — contratos Pydantic 2.
- **`app/services/`** — lógica: FFmpeg/FFprobe, storage, proyectos, parsers de
  transcripción (SRT/VTT/JSON/TXT), validación y exportación.
- **`app/workers/`** — trabajos en segundo plano (futuros). Sin Celery ni Redis.

### Transcripciones

- Modelo normalizado independiente del formato de origen:
  `Transcript` → `TranscriptSegment` → `TranscriptWord`.
- Una transcripción activa por proyecto (reemplazo al reimportar).
- TXT sin tiempos → estado `unsynced`.
- Video servido con `FileResponse` (Range) en
  `GET /api/projects/{id}/media/video` para el `<video>` HTML5.

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
- `temp/` — archivos intermedios (futuro).
- `exports/` — videos exportados (futuro).

Las carpetas se versionan vacías (`.gitkeep`); su contenido está en `.gitignore`.

## Principios

- Plataforma objetivo: **macOS**.
- Ejecución **100% local**; sin servicios externos obligatorios.
- Sin **Celery** ni **Redis**.
- Rutas siempre con **`pathlib`**, nunca concatenando strings.
- Sin blobs binarios en SQLite.
- Dependencias mínimas y justificadas.
