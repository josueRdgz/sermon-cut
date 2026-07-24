# Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir un video
de una predicación en **Shorts / Reels verticales**: importar la transcripción,
identificar los mejores fragmentos, componer un Reel con varios segmentos no
consecutivos y exportar un video vertical con subtítulos y una pantalla final.

> **Estado actual:** proyectos locales + importación/normalización de
> transcripciones (SRT, WebVTT, JSON interno, TXT) + **transcripción local con
> faster-whisper** + **Reels compuestos por varios fragmentos no consecutivos**
> (línea de tiempo, vista previa lógica) + **render real a MP4 con FFmpeg**
> (corta, une y normaliza los fragmentos).
> **Todavía no:** subtítulos quemados, pantalla final, Gemini ni generación
> automática de clips.

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

### FFmpeg: qué necesita el render

El render de Reels usa el binario `ffmpeg` del sistema (nunca `shell=True`; los
argumentos se pasan siempre como lista explícita a `subprocess`). El build de
Homebrew incluye todo lo necesario:

- **FFmpeg 5.0 o superior** (probado con 6.x y 7.x). Se requiere ≥ 4.3 por el
  filtro `xfade`, usado en las transiciones con fundido.
- **`libx264`** habilitado (`--enable-libx264`) para el video H.264.
- **Codificador AAC** — el nativo de FFmpeg (`aac`) es suficiente.
- **Filtros**: `scale`, `crop`, `overlay`, `gblur`, `fps`, `concat`, `xfade`,
  `afade`, `acrossfade`, `aresample`, `loudnorm`, y `lavfi`/`anullsrc` para
  generar silencio cuando el video original no tiene pista de audio.

Comprobación rápida:

```bash
ffmpeg -hide_banner -encoders | grep -E 'libx264|\baac\b'
ffmpeg -hide_banner -filters  | grep -E 'xfade|gblur|loudnorm|acrossfade'
```

Si `ffmpeg` no está en el `PATH`, el endpoint de render responde `503` con
`code: "ffmpeg_missing"`.

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
4. En **Reels**, selecciona uno o más segmentos de la transcripción (pueden no ser
   contiguos) y pulsa **Crear Reel desde selección**. Añade más fragmentos con
   **Añadir otro fragmento** o **Añadir selección al Reel actual**.
5. Ajusta inicio/fin con precisión decimal (±1 s / ±0.1 s) y usa **Vista previa
   lógica** para reproducir fragmento → salto → fragmento (sin generar un archivo).
6. Exporta la transcripción a SRT, VTT o JSON interno cuando quieras.

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
| CRUD | `/api/projects/{id}/reels`… | Reels y metadatos |
| POST | `/api/projects/{id}/reels/from-transcript` | Crear/añadir desde segmentos de transcripción |
| POST/PATCH/DELETE | `/api/projects/{id}/reels/{reelId}/segments`… | Fragmentos del Reel |
| PUT | `/api/projects/{id}/reels/{reelId}/segments/order` | Reordenar fragmentos |
| POST | `/api/projects/{id}/reels/{reelId}/render` | Iniciar render con FFmpeg (202) |
| GET | `/api/projects/{id}/reels/{reelId}/render` | Último render (para polling) |
| GET | `/api/projects/{id}/reels/{reelId}/renders` | Historial de renders del Reel |
| GET | `/api/render-jobs/{id}` | Estado de un render |
| POST | `/api/render-jobs/{id}/cancel` | Cancelar un render |
| GET | `/api/render-jobs/{id}/output?download=true` | Reproducir o descargar el MP4 |

Errores de dominio: `{ "detail": "...", "code": "..." }`.

Transcripción local: cuerpo `{ "model_name": "small", "language": "auto" }`
(`tiny|base|small|medium|large-v3`; `auto|es|en`). El frontend hace polling
cada 1.5 s.

## Reels (fragmentos no consecutivos)

Un Reel **no** es un único intervalo `inicio–fin`. Es una lista ordenada de
ventanas sobre el video original, por ejemplo:

```
00:10:20–00:10:42
+
00:11:05–00:11:29
+
00:12:01–00:12:18
```

- Aspectos: `9:16`, `1:1`, `16:9`.
- Transiciones entre fragmentos: `hard_cut`, `short_crossfade`, `dip_to_black`.
- Validaciones: inicio &lt; fin, duración mínima (`SERMON_CUT_MIN_REEL_SEGMENT_SECONDS`),
  dentro de la duración del video, orden `0..n-1` denso.
- Duración final = suma de ventanas + ms de transición entre fragmentos (la del último se ignora).
- La UI muestra cada **salto** en la línea de tiempo y una vista previa lógica
  (reproduce, salta al siguiente, se detiene).

## Render de un Reel (FFmpeg)

Desde el editor de Reels, el panel **«Exportar video»** produce un **MP4
H.264 + AAC** real: corta cada ventana del video original, las une y normaliza
el resultado. Todavía **sin subtítulos ni pantalla final**.

**Salida y lienzo**

| Aspecto | Resolución |
| ------- | ---------- |
| `9:16`  | 1080 × 1920 |
| `1:1`   | 1080 × 1080 |
| `16:9`  | 1920 × 1080 |

**Encuadres** (`layout`):

- `center_crop` — escala para cubrir el lienzo y recorta el centro.
- `blurred_background` — rellena el lienzo con una copia **desenfocada** y coloca
  el video original completo, visible y **centrado** encima. Útil para llevar un
  sermón horizontal a 9:16 sin perder los bordes del cuadro.

**Cómo se garantiza la calidad del corte**

- Cada fragmento entra como una entrada propia con `-accurate_seek -ss … -t …`:
  FFmpeg busca el keyframe anterior y descarta cuadros hasta el instante exacto,
  así que los cortes son precisos al fotograma. **Siempre se recodifica**; nunca
  se usa solo `-c copy`.
- Todos los fragmentos se normalizan en `filter_complex` a la **misma
  resolución, FPS constante, `yuv420p` y audio estéreo 48 kHz** antes de unirse,
  que es lo que hace seguro concatenar ventanas arbitrarias.
- Se aplica un **fade de audio de ~15 ms** en cada borde para que los empalmes no
  produzcan clics.
- `hard_cut` usa `concat`; `short_crossfade` y `dip_to_black` usan `xfade` +
  `acrossfade` con **la misma duración**, de modo que audio y video se acortan
  exactamente igual y no se desincronizan.
- Con `Normalizar audio` activo se aplica `loudnorm` (≈ −16 LUFS) a la mezcla final.

**Casos que se manejan automáticamente**

- **Sin pista de audio**: se genera silencio con `anullsrc` para que la salida
  siempre tenga un audio uniforme.
- **Audio mono o multicanal**: se convierte a estéreo con `aformat`.
- **FPS variable**: se fuerza un FPS constante con el filtro `fps` (12–60,
  derivado del original; 30 si no se puede determinar).
- **Rotación en metadatos**: FFmpeg aplica la matriz de rotación al decodificar,
  así que un video grabado de lado se orienta bien sin `transpose` manual.
- **Videos verticales originales**: se escalan al lienzo sin recorte innecesario.

**Progreso, cancelación y archivos**

- El progreso se obtiene parseando `-progress pipe:1` y se guarda en SQLite; el
  frontend hace polling cada 1.5 s (etapa, porcentaje, tiempo procesado, velocidad).
- **Cancelar** termina el proceso de FFmpeg y no deja archivo de salida.
- Los temporales viven **dentro de la carpeta del proyecto**
  (`storage/projects/{id}/renders/.tmp/`) y se borran al finalizar.
- El resultado se guarda en `storage/projects/{id}/renders/` con un nombre
  derivado del título del Reel. **Nunca se sobrescribe** un render anterior: se
  añade un sufijo numérico (`mi-reel.mp4`, `mi-reel-2.mp4`, …).
- El comando FFmpeg **saneado** (con comillas, copiable a la terminal) se
  registra en el log y puede verse en la UI para depuración.

## Configuración

- `SERMON_CUT_MAX_UPLOAD_BYTES` — límite por archivo de media (default 4 GiB).
- `SERMON_CUT_WHISPER_MODEL` — modelo por defecto (default `small`).
- `SERMON_CUT_WHISPER_DEVICE` — `auto|cuda|cpu` (default `auto`).
- `SERMON_CUT_WHISPER_COMPUTE_TYPE` — `auto|int8|float16|…` (default `auto`).
- `SERMON_CUT_KEEP_TEMP_AUDIO` — conservar el WAV temporal (default `false`).
- `SERMON_CUT_MIN_REEL_SEGMENT_SECONDS` — duración mínima de un fragmento (default `0.1`).

## Calidad

```bash
# backend/
pytest && ruff check .

# frontend/
npm run test && npm run lint && npx tsc --noEmit
```

`backend/tests/test_render_args.py` cubre el generador de argumentos FFmpeg y el
parseo de `-progress`. `test_render_api.py` incluye una **prueba de integración
opcional** que genera un clip sintético y lo renderiza con el FFmpeg real; se
omite automáticamente (`skipif`) si `ffmpeg` no está instalado.

## Diseño

- macOS, 100% local, sin Celery/Redis.
- Rutas con `pathlib`; sin blobs en SQLite.
- El `<video>` usa la URL de stream; no se carga el archivo entero en memoria JS.

## Licencia

[MIT](LICENSE).
