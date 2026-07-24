# Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir un video
de una predicación en **Shorts / Reels verticales**: importar la transcripción,
identificar los mejores fragmentos, componer un Reel con varios segmentos no
consecutivos y exportar un video vertical con subtítulos y una pantalla final.

> **Estado:** base del proyecto. Este commit inicial incluye únicamente el
> esqueleto (health check, detección de FFmpeg, SQLite + Alembic y una página
> inicial en React). **Todavía no** hay transcripción, integración con Gemini
> ni edición de video.

## Requisitos (macOS)

- **macOS** (plataforma objetivo)
- **Homebrew** (recomendado para instalar dependencias del sistema)
- **Python 3.12+**
- **Node.js 18+** (probado con 20) y **npm**
- **FFmpeg** y **FFprobe** instalados y disponibles en el `PATH`
- **git**

Instala las dependencias del sistema con Homebrew:

```bash
brew install python@3.12 node ffmpeg
```

Verifica FFmpeg:

```bash
ffmpeg -version
ffprobe -version
```

## Estructura

```
backend/    FastAPI + SQLAlchemy 2 + Alembic + SQLite
frontend/   React + Vite + TypeScript
storage/    projects/ temp/ exports/  (contenido ignorado por git)
scripts/    scripts de arranque para macOS
docs/       documentación de arquitectura
```

Detalles en [`docs/architecture.md`](docs/architecture.md).

## Puesta en marcha

Copia las variables de entorno de ejemplo:

```bash
cp .env.example .env
```

### Opción A — Scripts (recomendado)

En dos terminales:

```bash
./scripts/start-backend.sh
./scripts/start-frontend.sh
```

### Opción B — Manual

**Backend:**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Luego abre <http://localhost:5173>. La página muestra el estado del backend, si
FFmpeg está disponible y su versión. El botón **"Crear proyecto"** está
deshabilitado (llegará en una fase posterior).

## API

| Método | Ruta          | Descripción                                             |
| ------ | ------------- | ------------------------------------------------------- |
| GET    | `/api/health` | Estado del backend y versiones de FFmpeg / FFprobe.     |

Ejemplo de respuesta:

```json
{
  "status": "ok",
  "app_name": "Sermon Cut",
  "ffmpeg": { "available": true, "version": "8.1" },
  "ffprobe": { "available": true, "version": "8.1" }
}
```

## Base de datos y migraciones

SQLite en `storage/sermon_cut.db`. Migraciones con Alembic (desde `backend/`):

```bash
alembic revision --autogenerate -m "mensaje"
alembic upgrade head
```

## Calidad

**Backend** (desde `backend/`):

```bash
pytest        # tests
ruff check .  # linting
```

**Frontend** (desde `frontend/`):

```bash
npm run test          # Vitest
npm run lint          # ESLint
npm run format:check  # Prettier
```

## Diseño y restricciones

- Plataforma objetivo: **macOS**.
- Ejecución **100% local**; sin servicios externos obligatorios.
- **Sin Celery ni Redis.**
- Rutas con **`pathlib`**, nunca concatenando strings.
- CORS limitado al servidor de desarrollo local (`http://localhost:5173`).

## Licencia

[MIT](LICENSE).
