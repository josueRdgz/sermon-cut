# Arquitectura de Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir videos de
predicaciones en Shorts / Reels verticales con subtítulos y una pantalla final.

> Esta es la **base** del proyecto. Todavía no hay transcripción, integración con
> Gemini ni edición de video.

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
                                    SQLAlchemy 2        FFmpeg/FFprobe        storage/
                                    + Alembic            (del sistema)     projects/temp/exports
                                          │
                                     SQLite (archivo local)
```

## Backend (`backend/`)

Organización por capas para separar responsabilidades:

- **`app/api/`** — routers de FastAPI. Se agregan en `api_router` y se montan con
  el prefijo `/api`.
- **`app/core/`** — configuración (`config.py`, con pydantic-settings) y rutas del
  sistema de archivos (`paths.py`, todo con `pathlib`).
- **`app/db/`** — `Base` declarativa (SQLAlchemy 2), `engine` y `SessionLocal`.
- **`app/models/`** — modelos ORM (aún vacío; punto único de registro para Alembic).
- **`app/schemas/`** — contratos de entrada/salida con Pydantic 2.
- **`app/services/`** — lógica reutilizable (p. ej. detección de FFmpeg/FFprobe).
- **`app/workers/`** — trabajos en segundo plano (futuros). Sin Celery ni Redis:
  se usarán tareas locales.

### Migraciones

Alembic lee la URL de la base de datos y el `metadata` desde la propia aplicación
(`alembic/env.py`), de modo que las migraciones siempre coinciden con la config de
ejecución. Se usa `render_as_batch=True` por compatibilidad con SQLite.

## Frontend (`frontend/`)

- **`src/api/`** — cliente HTTP tipado (`client.ts`) y llamadas concretas
  (`health.ts`).
- **`src/types/`** — tipos TypeScript que reflejan los schemas del backend.
- **`src/hooks/`** — hooks de React (`useHealth`).
- **`src/pages/`** — páginas (`HomePage`).
- **`src/components/`** — componentes reutilizables.
- **`src/features/`**, **`src/utils/`** — reservados para el crecimiento futuro.

En desarrollo, Vite hace *proxy* de `/api` hacia `http://127.0.0.1:8000`, así el
frontend usa URLs relativas.

## Almacenamiento (`storage/`)

- `projects/` — datos por proyecto.
- `temp/` — archivos intermedios.
- `exports/` — videos exportados.

Las carpetas se versionan vacías (`.gitkeep`); su contenido está en `.gitignore`.

## Principios

- Plataforma objetivo: **macOS**.
- Ejecución **100% local**; sin servicios externos obligatorios.
- Sin **Celery** ni **Redis**.
- Rutas siempre con **`pathlib`**, nunca concatenando strings.
- Dependencias mínimas y justificadas.
