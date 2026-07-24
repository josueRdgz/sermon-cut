# Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir un video
de una predicación en **Shorts / Reels verticales**: importar la transcripción,
identificar los mejores fragmentos, componer un Reel con varios segmentos no
consecutivos y exportar un video vertical con subtítulos y una pantalla final.

> **Estado actual:** proyectos locales + importación/normalización de
> transcripciones (SRT, WebVTT, JSON interno, TXT) + **transcripción local con
> faster-whisper** (segmentos y palabras con tiempos, progreso y cancelación),
> con editor y reproductor.
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
2. En el detalle del proyecto, **transcribe localmente** (elige modelo e idioma)
   o importa una **transcripción** existente (SRT / VTT / JSON / TXT).
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
`uploaded_txt`, `whisper` (transcripción local) — y reservadas: `youtube`, `manual`.

## Transcripción local (faster-whisper)

Convierte el audio del video en texto **sin ninguna API externa**, usando
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) (backend
CTranslate2). El flujo:

1. Extrae el audio del video con **FFmpeg** a **WAV mono 16 kHz**.
2. Ejecuta faster-whisper con **word timestamps** activados.
3. Guarda segmentos y palabras en el modelo de transcripción existente
   (`source = whisper`), reemplazando cualquier transcripción previa.

La ejecución la gestiona un **administrador de trabajos en proceso** basado en
`ThreadPoolExecutor` (un worker), con el estado del trabajo **persistido en
SQLite**. No se usan Celery ni Redis. Estados del trabajo: `queued`, `running`,
`cancelling`, `cancelled`, `completed`, `failed`.

### Instalación

`faster-whisper` es una dependencia **opcional** (es pesada). Instálala solo si
vas a transcribir localmente:

```bash
cd backend
source .venv/bin/activate
pip install -e ".[whisper]"
```

### Dispositivo (CUDA / CPU) y Apple Silicon

- Con **GPU NVIDIA + CUDA** disponible, se usa `cuda` con cómputo `float16`.
- En cualquier otro caso se usa **CPU** (cómputo `int8`).
- **Apple Silicon (M1/M2/M3):** faster-whisper/CTranslate2 **no soportan
  Metal/GPU**, así que **siempre se ejecuta en CPU**. La app **no afirma** usar
  la GPU de Apple y muestra un aviso claro en la interfaz. Para mayor rapidez,
  usa un modelo más pequeño (`small` o `base`).

Puedes forzar el dispositivo con `SERMON_CUT_WHISPER_DEVICE` (`auto|cuda|cpu`).

### Modelos y espacio aproximado

| Modelo | Tamaño en disco (aprox.) | Uso recomendado |
| ------ | ------------------------ | --------------- |
| `tiny` | ~75 MB | Pruebas rápidas, baja calidad |
| `base` | ~145 MB | Rápido |
| `small` | ~490 MB | **Recomendado** para equipos modestos |
| `medium` | ~1.5 GB | Mayor calidad (hardware más potente) |
| `large-v3` | ~3 GB | Máxima calidad, más lento y con más RAM |

- **Primera descarga:** la primera vez que usas un modelo, faster-whisper lo
  descarga automáticamente desde Hugging Face y lo **cachea** en
  `~/.cache/huggingface/`. Requiere conexión a internet **solo esa primera vez**;
  después funciona sin conexión. El proceso puede tardar según tu ancho de banda.
- Los **tests no descargan modelos**: usan un motor simulado.

### Limitaciones de rendimiento

- En **CPU** (incluido Apple Silicon) la transcripción es bastante más lenta que
  en GPU; con `medium`/`large-v3` puede tardar **varias veces la duración** del
  audio. Empieza con `small`.
- Solo se ejecuta **una transcripción a la vez por proyecto** (se rechaza con
  `409` si ya hay una en curso).
- El WAV temporal se elimina al terminar; ponlo a conservar con
  `SERMON_CUT_KEEP_TEMP_AUDIO=true` para depurar.

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
| POST | `/api/projects/{id}/transcription` | Iniciar transcripción local (202) |
| GET | `/api/projects/{id}/transcription` | Último trabajo (para polling) |
| GET | `/api/transcription-jobs/{id}` | Estado de un trabajo |
| POST | `/api/transcription-jobs/{id}/cancel` | Cancelar un trabajo |

Errores de dominio: `{ "detail": "...", "code": "..." }`.

Cuerpo para iniciar: `{ "model_name": "small", "language": "auto" }`
(`model_name`: `tiny|base|small|medium|large-v3`; `language`: `auto|es|en`).
El frontend hace **polling cada 1.5 s** y muestra etapa, porcentaje, tiempo
procesado / duración total, dispositivo y errores.

## Configuración

- `SERMON_CUT_MAX_UPLOAD_BYTES` — límite por archivo de media (default 4 GiB).
- `SERMON_CUT_WHISPER_MODEL` — modelo por defecto (default `small`).
- `SERMON_CUT_WHISPER_DEVICE` — `auto|cuda|cpu` (default `auto`).
- `SERMON_CUT_WHISPER_COMPUTE_TYPE` — `auto|int8|float16|…` (default `auto`).
- `SERMON_CUT_KEEP_TEMP_AUDIO` — conservar el WAV temporal (default `false`).

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
