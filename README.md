# Sermon Cut

Aplicación **local para macOS** y de **código abierto** para convertir un video
de una predicación en **Shorts / Reels verticales**: importar la transcripción,
identificar los mejores fragmentos, componer un Reel con varios segmentos no
consecutivos y exportar un video vertical con subtítulos y una pantalla final.

> **Estado actual:** proyectos locales + importación/normalización de
> transcripciones (SRT, WebVTT, JSON interno, TXT) + **transcripción local con
> faster-whisper** + **Reels compuestos por varios fragmentos no consecutivos**
> + **render real a MP4 con FFmpeg** + **subtítulos ASS incrustados** (plantillas
> y quemado con libass) + **pantalla final obligatoria** (3 diseños generados con
> Pillow) + **análisis editorial opcional** (Gemini o mock).
> **Todavía no:** generación automática de clips sin revisión humana ni Gemini
> obligatorio.

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
- **Filtros**: `scale`, `crop`, `pad`, `overlay`, `gblur`, `fps`, `concat`,
  `xfade`, `fade`, `afade`, `acrossfade`, `apad`, `atrim`, `volume`, `aresample`,
  `loudnorm`, `ass` (libass) y `lavfi`/`anullsrc` para generar silencio cuando el
  video original no tiene pista de audio.
- Un **demuxer de imagen** (`-loop 1`) para concatenar la pantalla final.

Comprobación rápida:

```bash
ffmpeg -hide_banner -encoders | grep -E 'libx264|\baac\b'
ffmpeg -hide_banner -filters  | grep -E 'xfade|gblur|loudnorm|acrossfade|\bass\b'
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
# Opcional — encuadre vertical con OpenCV:
pip install -e ".[tracking]"
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
| POST | `/api/projects/{id}/reels/{reelId}/validate` | Validar coherencia de la unión |
| POST | `/api/projects/{id}/reels/{reelId}/validate/dismiss` | Ignorar una advertencia |
| POST | `/api/projects/{id}/reels/{reelId}/validate/expand-context` | Ampliar un fragmento con contexto |
| POST | `/api/projects/{id}/reels/{reelId}/cut-suggestions` | Generar sugerencias de corte técnico |
| GET | `/api/projects/{id}/reels/{reelId}/cut-suggestions` | Listar sugerencias pendientes/aceptadas/rechazadas |
| POST | `/api/projects/{id}/reels/{reelId}/cut-suggestions/{sid}/accept` | Aceptar una sugerencia (única vía que muta) |
| POST | `/api/projects/{id}/reels/{reelId}/cut-suggestions/{sid}/reject` | Rechazar una sugerencia |
| GET/PUT | `/api/projects/{id}/reels/{reelId}/framing` | Modo de encuadre vertical |
| POST/DELETE | `/api/projects/{id}/reels/{reelId}/framing/track` | Calcular o borrar tracking (caché) |
| PUT | `/api/projects/{id}/reels/{reelId}/segments/{sid}/manual-crop` | Cuadro manual por fragmento |
| GET | `/api/projects/{id}/reels/{reelId}/framing/preview` | Metadatos de vista previa del crop |
| GET | `/api/framing/mediapipe` | Compatibilidad MediaPipe (opcional) |
| GET | `/api/subtitle-templates` | Plantillas ASS disponibles |
| GET | `/api/projects/{id}/reels/{reelId}/subtitle-preview` | Cues remapeados (vista previa) |
| GET | `/api/end-card/layouts` | Diseños de pantalla final |
| GET/PUT | `/api/end-card/settings` | Configuración global de la pantalla final |
| GET/PUT/DELETE | `/api/projects/{id}/end-card/settings` | Configuración por proyecto (DELETE vuelve a la global) |
| POST | `/api/projects/{id}/end-card/logo` | Subir logo opcional |
| POST | `/api/projects/{id}/end-card/music` | Subir música local del usuario |
| GET | `/api/projects/{id}/end-card/preview` | PNG de la pantalla final (vista previa) |
| GET | `/api/analysis/provider` | Estado del proveedor (Gemini opcional / mock) |
| POST | `/api/projects/{id}/analysis` | Iniciar análisis editorial (202) |
| GET | `/api/projects/{id}/analysis` | Último trabajo de análisis (polling) |
| POST | `/api/analysis-jobs/{jobId}/cancel` | Cancelar análisis |
| GET | `/api/projects/{id}/analysis/candidates` | Candidatos pendientes/aceptados/descartados |
| POST | `/api/projects/{id}/analysis/candidates/{cid}/accept` | Aceptar → crea Reel (sin render) |
| POST | `/api/projects/{id}/analysis/candidates/{cid}/reject` | Descartar candidato |
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
- **Coherencia de unión** (antes del render): reglas deterministas + sondas de
  audio/plano + revisión opcional con Gemini del guion unido (sin reescribir).
  Resultados `valid` / `warning` / `blocked`. Cada hallazgo trae `code`,
  `message`, `segment_id` y recomendación. Puedes ignorar advertencias, editar
  tiempos, añadir contexto o eliminar el fragmento; los bloqueos no se ignoran.
- **Cortes técnicos opcionales**: análisis de silencios (`silencedetect`),
  pausas largas y muletillas/repeticiones/falsos comienzos. Intensidad por
  defecto `conservative`. Las sugerencias aparecen en la línea de tiempo; solo
  se aplican al **aceptar** (nunca solas). Al aceptar se mantiene margen de
  respiración, se usa un crossfade corto si hay división, y los subtítulos se
  recalculan desde las nuevas ventanas.
- **Encuadre vertical opcional**: seguimiento de rostro/persona (OpenCV;
  MediaPipe evaluado como opcional). Modos: seguimiento automático, recorte
  central, fondo desenfocado, posición manual por fragmento. Vista previa del
  crop; caché borrable/recalculable. FFmpeg aplica el `crop` final (OpenCV no
  renderiza el MP4). Tracking inestable → degradación a fondo desenfocado.
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

## Subtítulos incrustados (ASS / libass)

Los subtítulos se generan como **ASS** y se queman en el MP4 con el filtro
`ass` de FFmpeg (libass). Los tiempos **no** son los del video original: se
recalculan sobre la línea temporal final del Reel.

Ejemplo con cortes duros: segmento A de 20 s + segmento B de 30 s → B empieza en
el segundo **20** de la salida. Con crossfade, el solape usable se resta (igual
que en el grafo FFmpeg).

**Plantillas**

| ID | Idea |
| -- | ---- |
| `reformed_sober` | Blanco + contorno oscuro, máx. 2 líneas, tipografía seria, sin emojis |
| `modern_highlight` | Grupos cortos; palabra actual resaltada (karaoke ASS); máx. 5–6 palabras |
| `clear_reading` | Dos líneas, caja semitransparente, sin animación |
| `sermon_quote` | Cita; referencia bíblica opcional |

**Granularidad:** `auto` | `segment` | `phrase` | `word`. Si no hay word
timestamps, se degrada a frase/segmento. Solo se usan palabras **vivas** de la
transcripción: una palabra borrada no reaparece aunque quede texto antiguo en el
fragmento del Reel.

**Fuentes:** solo tipografías **instaladas en el sistema** (p. ej. Helvetica Neue,
Arial, Georgia en macOS). Se copian a un `fontsdir` temporal para libass. **No**
se descargan fuentes de Internet ni se incluyen tipografías comerciales en el
repo.

**Personalización en la UI:** estilo, tamaño, posición, mayúsculas, máx. de
palabras, opacidad, margen inferior, con vista previa sobre el reproductor.

## Pantalla final (obligatoria)

Todo Reel termina con una pantalla final. **No se puede desactivar**; la UI la
marca como `Obligatoria`. Dura entre **3 y 8 segundos** (por defecto 5 s, con
fade in de 300 ms y fade out del audio principal de 500 ms).

Muestra la portada de la predicación, el título del sermón, el texto «Ver sermón
completo en nuestro canal de YouTube», el nombre de la iglesia y el
identificador del canal, más logo, URL y código QR opcionales.

**Diseños**

| ID | Idea |
| -- | ---- |
| `cover_full` | La portada llena la pantalla, oscurecida para que el texto se lea |
| `cover_card` | La portada dentro de una tarjeta con esquinas redondeadas sobre un fondo desenfocado |
| `minimal` | Fondo limpio, logo arriba y título con tipografía serif; no necesita portada |

**Generación de la imagen:** se compone con **Pillow** y se guarda como PNG
temporal. No hay navegador ni motor headless de por medio: funciona sin red y en
cualquier equipo. Las tipografías son las **instaladas en el sistema**, igual que
en los subtítulos.

**Zonas seguras y texto:** todos los elementos viven dentro de un rectángulo que
deja libre un 8 % a los lados, un 10 % arriba y un 16 % abajo, para que la UI de
Shorts / Reels no tape nada. El espacio vertical se reparte **antes** de dibujar
(bandas para la portada, el QR y el logo), y cada párrafo se ajusta a lo que
queda: el título pasa a varias líneas automáticamente, la fuente se reduce si
hace falta y, como último recurso, se recorta con «…». El texto nunca desborda.

**Audio de la pantalla final**

- `silence` — el audio principal hace fade out en el empalme y la pantalla queda
  en silencio.
- `continue_with_fade` — el audio del video **continúa** desde donde acabó el
  último fragmento y se desvanece al final de la tarjeta. Si el video ya no tiene
  material que reproducir, degrada a `silence`.
- `local_music` — usa **un archivo tuyo** subido al proyecto, con volumen
  ajustable y fades. Nunca se descarga música automáticamente; sin archivo
  subido, el modo se rechaza (`code: "end_card_music_missing"`).

**Configuración global y por proyecto:** existe una fila global de
`EndCardSettings` (`project_id IS NULL`) y, opcionalmente, una fila por proyecto
que la sobrescribe. Desde la UI se puede guardar la configuración actual como
global o volver a heredarla.

**Concatenación:** la PNG entra como una entrada `-loop 1` y se une con `concat`
**después** de quemar los subtítulos, así que los tiempos de los cues siguen
siendo relativos al contenido principal.

## Análisis editorial opcional (Gemini)

La aplicación **sigue funcionando sin Gemini**. Si no hay clave, el análisis usa
un `MockAIProvider` determinista (útil para tests y demos offline).

```bash
cd backend
source .venv/bin/activate
pip install -e ".[gemini]"   # SDK oficial google-genai
# En .env (nunca en Git):
# SERMON_CUT_GEMINI_API_KEY=...
# SERMON_CUT_AI_PROVIDER=auto   # auto | mock | gemini
```

**Arquitectura** (`backend/app/services/ai/`):

| Archivo | Rol |
| ------- | --- |
| `base.py` | Interfaz abstracta `AIProvider` |
| `schemas.py` | Request/response Pydantic (`clips` con segmentos no consecutivos) |
| `prompts.py` | Prompt editorial reformado + merge global |
| `gemini_provider.py` | SDK `google-genai`, JSON estructurado, timeout y reintentos acotados |
| `mock_provider.py` | Proveedor determinista para tests |

El proveedor recibe metadatos del sermón, transcripción sincronizada, duración,
preferencias (máx. Reels, duración min/máx, orientación doctrinal, instrucciones
adicionales) y devuelve JSON validado por Pydantic.

**Pipeline:**

1. Dividir transcripciones largas en bloques conservando tiempos absolutos.
2. Analizar cada bloque.
3. Etapa final `merge_candidates` que combina y ordena candidatos globales.
4. Validación local obligatoria:
   - `exact_text` debe existir aproximadamente en el intervalo;
   - tiempos ajustados a límites reales de palabras;
   - rechazo de intervalos fuera del video, invertidos, solapes inválidos o sin
     evidencia;
   - advertencias si la confianza es baja.
5. Persistir candidatos en `pending`. **Nunca se renderiza automáticamente.**
6. El usuario acepta (crea un Reel en borrador) o descarta cada candidato.

La clave de API solo se lee de `SERMON_CUT_GEMINI_API_KEY` (entorno / `.env`
local). Los reintentos se limitan a errores transitorios (máx. 3) con backoff;
si la API expone métricas de tokens, se registran en el trabajo.

## Configuración

- `SERMON_CUT_MAX_UPLOAD_BYTES` — límite por archivo de media (default 4 GiB).
- `SERMON_CUT_WHISPER_MODEL` — modelo por defecto (default `small`).
- `SERMON_CUT_WHISPER_DEVICE` — `auto|cuda|cpu` (default `auto`).
- `SERMON_CUT_WHISPER_COMPUTE_TYPE` — `auto|int8|float16|…` (default `auto`).
- `SERMON_CUT_KEEP_TEMP_AUDIO` — conservar el WAV temporal (default `false`).
- `SERMON_CUT_MIN_REEL_SEGMENT_SECONDS` — duración mínima de un fragmento (default `0.1`).
- `SERMON_CUT_AI_PROVIDER` — `auto|mock|gemini` (default `auto`).
- `SERMON_CUT_GEMINI_API_KEY` — clave local; nunca en el repositorio.
- `SERMON_CUT_GEMINI_MODEL` — modelo Gemini (default `gemini-2.5-flash`).
- `SERMON_CUT_GEMINI_TIMEOUT_SECONDS` / `SERMON_CUT_GEMINI_MAX_ATTEMPTS`.
- `SERMON_CUT_AI_CHUNK_CHAR_LIMIT` — presupuesto de caracteres por bloque.

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
`test_subtitles.py` cubre el remapeo temporal tras múltiples cortes, la
degradación sin word timestamps y el filtro `ass` en el grafo.
`test_end_card.py` cubre el ajuste de texto (wrap, reducción de fuente, recorte
con «…»), el recorte de la duración a 3–8 s y el cableado de la pantalla final en
el grafo FFmpeg, incluida la degradación de los modos de audio.
`test_end_card_api.py` cubre la configuración global vs. por proyecto, las
subidas de logo/música y la vista previa PNG.
`test_analysis.py` / `test_analysis_api.py` cubren el mock determinista, el
ajuste de tiempos, el rechazo de texto inventado y el flujo aceptar/descartar
sin render automático.

## Diseño

- macOS, 100% local, sin Celery/Redis.
- Rutas con `pathlib`; sin blobs en SQLite.
- El `<video>` usa la URL de stream; no se carga el archivo entero en memoria JS.

## Licencia

[MIT](LICENSE).
