# Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir un video
de una predicación en **Shorts / Reels verticales**: importar la transcripción,
identificar los mejores fragmentos, componer un Reel con varios segmentos no
consecutivos y exportar un video vertical con subtítulos y una pantalla final.

> **Estado actual:** proyectos locales + importación/normalización de
> transcripciones (SRT, WebVTT, JSON interno, TXT) con editor y reproductor.
> **Todavía no:** Gemini, generación de clips ni renderizado final.

## Requisitos (macOS)

- **macOS** (plataforma objetivo)
- **Homebrew** (recomendado para instalar dependencias del sistema)
- **Python 3.12+**
- **Node.js 18+** (probado con 20) y **npm**
- **FFmpeg** y **FFprobe** instalados y disponibles en el `PATH`
- **git**

```bash
brew install python@3.12 node ffmpeg
ffmpeg -version && ffprobe -version
```

## Puesta en marcha

```bash
cp .env.example .env
./scripts/start-backend.sh   # terminal 1 (incluye migraciones si usas Option B)
./scripts/start-frontend.sh  # terminal 2
```

Backend manual: `cd backend && source .venv/bin/activate && alembic upgrade head && uvicorn app.main:app --reload --port 8000`

Abre <http://localhost:5173>.

## Cómo crear el primer proyecto

1. **Crear proyecto** → rellena título, iglesia, canal; sube video (y portada opcional).
2. En el detalle del proyecto, importa una **transcripción** (SRT / VTT / JSON / TXT).
3. Usa el buscador, edita segmentos y haz clic en uno para saltar en el video HTML5.
4. Exporta a SRT, VTT o JSON interno cuando quieras.

Los medios viven en `storage/projects/{uuid}/`. SQLite solo guarda metadatos.

## Formatos de transcripción compatibles

| Formato | Extensión | Tiempos | Notas |
| ------ | --------- | ------- | ----- |
| **SubRip** | `.srt` | Sí (segundos decimales) | Parser robusto; valida orden y solapes |
| **WebVTT** | `.vtt` | Sí | Requiere cabecera `WEBVTT`; elimina tags `<c>` etc. |
| **JSON interno** | `.json` | Opcional + palabras | Formato canónico de exportación (abajo) |
| **Texto plano** | `.txt` | No | Se guarda como `unsynced` (sin sincronizar) |

Fuentes registradas: `uploaded_srt`, `uploaded_vtt`, `uploaded_json`,
`uploaded_txt` (y reservadas para más adelante: `whisper`, `youtube`, `manual`).

Validaciones al importar (formatos con tiempo):

- tiempos ≥ 0;
- inicio < fin;
- segmentos ordenados por inicio;
- sin solapamientos inválidos (tocarse en el borde está permitido).

### JSON interno (exportación / importación)

```json
{
  "language": "es",
  "segments": [
    {
      "start": 10.2,
      "end": 14.8,
      "text": "Texto del segmento",
      "words": [
        { "start": 10.2, "end": 10.5, "text": "Texto" }
      ]
    }
  ]
}
```

Fixtures de ejemplo: `backend/tests/fixtures/transcripts/`.

## API (extracto)

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/health` | Estado + FFmpeg/FFprobe |
| CRUD | `/api/projects`… | Proyectos y media |
| GET | `/api/projects/{id}/media/video` | Stream del video (Range / HTML5) |
| POST | `/api/projects/{id}/transcript` | Subir/normalizar transcripción |
| GET | `/api/projects/{id}/transcript` | Consultar transcripción |
| DELETE | `/api/projects/{id}/transcript` | Eliminar transcripción |
| PATCH | `/api/transcripts/segments/{id}` | Editar texto/inicio/fin |
| GET | `/api/projects/{id}/transcript/export?format=srt\|vtt\|json` | Exportar |

Errores de dominio: `{ "detail": "...", "code": "..." }`.

## Configuración

- `SERMON_CUT_MAX_UPLOAD_BYTES` — límite por archivo de media (default 4 GiB).

## Calidad

```bash
# backend/
pytest && ruff check .

# frontend/
npm run test && npm run lint && npx tsc --noEmit
```

## Diseño

- macOS, 100% local, sin Celery/Redis.
- Rutas con `pathlib`; sin blobs en SQLite.
- El `<video>` usa la URL de stream; no se carga el archivo entero en memoria JS.

## Licencia

[MIT](LICENSE).
