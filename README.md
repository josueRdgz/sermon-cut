# Sermon Cut

Aplicación **local** y de **código abierto** (macOS, Windows y Linux) para
convertir un video de una predicación en **Shorts / Reels verticales** y
**Video Highlights horizontales**: importar
la transcripción, identificar los mejores fragmentos, componer un Reel con
varios segmentos no consecutivos y exportar un video vertical con subtítulos y
una pantalla final. **No requiere Docker.**

> **Estado actual:** proyectos locales + importación/normalización de
> transcripciones (SRT, WebVTT, JSON interno, TXT) + **transcripción local con
> faster-whisper** + **Reels compuestos por varios fragmentos no consecutivos**
> + **reparación local conservadora de microcortes**
> + **render real a MP4 con FFmpeg** + **subtítulos ASS incrustados** +
> **pantalla final obligatoria** + **análisis editorial opcional** (Gemini o
> mock) + **perfiles de exportación** + **música de fondo local opcional**.
> Ver [limitaciones actuales](docs/LIMITATIONS.md).

Video Highlights incorpora detección confirmable del intervalo de predicación,
selección narrativa por IA con duración objetivo, revisión manual, cinco títulos
estratégicos, metadatos de YouTube y exportación a la resolución horizontal de
la fuente con subtítulos quemados, SRT o ambos.

## Requisitos

| | macOS | Windows | Linux |
|--|-------|---------|-------|
| Python | 3.12+ | 3.12+ (añadir al PATH) | 3.12+ |
| Node.js / npm | 18+ (20 recomendado) | 18+ | 18+ |
| FFmpeg + FFprobe | Homebrew | winget / Chocolatey | apt / dnf |
| Docker | **No** | **No** | **No** |

```bash
# macOS (ejemplo)
brew install python@3.12 node ffmpeg
ffmpeg -version && ffprobe -version
```

```powershell
# Windows (ejemplo)
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

```bash
# Debian/Ubuntu (ejemplo)
sudo apt update
sudo apt install python3 python3-venv python3-pip ffmpeg nodejs npm
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

## Puesta en marcha (recomendada)

```bash
# macOS
./scripts/setup-macos.sh

# Linux
./scripts/setup-linux.sh
```

```powershell
# Windows (PowerShell)
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
```

Luego, en dos terminales:

```bash
./scripts/start-backend.sh    # o .\scripts\start-backend.ps1
./scripts/start-frontend.sh   # o .\scripts\start-frontend.ps1
```

El backend arranca sin autoreload para no interrumpir transcripciones, análisis
o renders en proceso. Durante desarrollo puedes activarlo con
`SERMON_CUT_RELOAD=true`; el watcher queda limitado a `backend/app/` y no vigila
el entorno virtual `.venv`.

Abre <http://localhost:5173>.

En macOS, la versión reducida de `ffmpeg` puede omitir libass. Para exportar
con subtítulos quemados instala `brew install ffmpeg-full`; la app detecta
automáticamente su ejecutable keg-only. También puedes definir
`SERMON_CUT_FFMPEG_PATH`.

Diagnóstico:

```bash
cd backend && source .venv/bin/activate
python -m app.cli doctor
```

Copia de configuración: `cp .env.example .env` (los scripts de setup lo hacen
si falta). Almacenamiento configurable con `SERMON_CUT_STORAGE_DIR`. Las
migraciones se aplican al arrancar el API (con protección ante fallos) y también
vía `python -m app.cli migrate`.

Datos de prueba libres de derechos: carpeta [`demo/`](demo/README.md).

## Cómo crear el primer proyecto

1. **Crear proyecto** → rellena título, iglesia, canal; elige el **origen del
   video**: **archivo local** (método principal) o **URL de YouTube** (opcional,
   ver abajo); sube portada opcional.
2. Si el audio presenta cortes, abre **Reparar audio**, ejecuta el análisis y
   compara Original/Reparado antes de descargar la copia corregida.
3. **Transcribe localmente** (elige modelo e idioma) o importa una
   **transcripción** existente (SRT / VTT / JSON / TXT).
4. Usa el buscador, edita segmentos y haz clic en uno para saltar en el video HTML5.
5. En **Reels**, selecciona uno o más segmentos de la transcripción (pueden no ser
   contiguos) y pulsa **Crear Reel desde selección**. Añade más fragmentos con
   **Añadir otro fragmento** o **Añadir selección al Reel actual**.
6. Ajusta inicio/fin con precisión decimal (±1 s / ±0.1 s) y usa **Vista previa
   lógica** para reproducir fragmento → salto → fragmento (sin generar un archivo).
7. Exporta la transcripción a SRT, VTT o JSON interno cuando quieras.

Los medios viven en `storage/projects/{uuid}/`. SQLite solo guarda metadatos.

## Importar desde YouTube (opcional)

La subida de archivos locales es el método **principal y estable**. De forma
**opcional** puedes crear un proyecto a partir de la **URL de un video
individual de YouTube**: la app lo descarga a tu almacenamiento local y luego lo
procesa **exactamente igual** que un video subido manualmente.

La aplicación de escritorio incluye **`yt-dlp`**. En desarrollo desde el
repositorio se instala como dependencia Python. En ambos casos también debes
tener **FFmpeg/FFprobe**. Comprueba el entorno con `python -m app.cli doctor`.

Flujo en la UI (**Nueva predicación → Origen del video → URL de YouTube**):

1. Pega la URL y pulsa **Comprobar video** (vista previa: título, canal,
   duración, miniatura, resolución, fecha).
2. Elige la **calidad** (720p, 1080p por defecto, o «mejor disponible» — nunca
   4K por defecto).
3. Acepta el aviso de derechos y pulsa **Crear proyecto**: verás progreso por
   fases (metadatos → video → audio → fusión → validación) y un botón
   **Cancelar**.

Detalles y límites:

- Solo **videos individuales** de `youtube.com` / `youtu.be` (incluidos Shorts y
  directos ya finalizados). Se rechazan playlists, canales, búsquedas,
  directos activos y videos sin streams descargables. Si la URL trae playlist +
  video, se importa **solo el video** (`--no-playlist`).
- Salida orientada a edición: **H.264 + AAC en MP4** con *fallback* robusto.
- Primera versión **sin autenticación**: solo videos públicos o no listados.
- **Importa únicamente videos propios o autorizados.** Eres responsable de
  respetar los derechos de autor y las condiciones de la plataforma.
- YouTube cambia con frecuencia: mantén `yt-dlp` actualizado. Algunas URLs pueden
  fallar temporalmente; la **subida local es el fallback estable**.
- Configúralo con `SERMON_CUT_YOUTUBE_*` (ver `.env.example`) o desactívalo con
  `SERMON_CUT_YOUTUBE_IMPORT_ENABLED=false`.

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
| POST | `/api/youtube/preview` | Validar URL + vista previa (yt-dlp) |
| POST | `/api/projects/{id}/youtube-import` | Iniciar import de YouTube (202) |
| GET | `/api/projects/{id}/youtube-import` | Último import (para polling) |
| GET | `/api/youtube-import-jobs/{id}` | Estado de un import |
| POST | `/api/youtube-import-jobs/{id}/cancel` | Cancelar un import |
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
| POST | `/api/projects/{id}/reels/{reelId}/validate/auto-fix` | Corregir automáticamente empalmes y revalidar |
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
| GET | `/api/background-music/presets` | Presets de música de fondo (`none` por defecto) |
| GET/PUT | `/api/projects/{id}/background-music` | Configuración de música de fondo (local) |
| POST | `/api/projects/{id}/background-music/upload` | Subir MP3/WAV/M4A/OGG del usuario |
| GET | `/api/projects/{id}/background-music/meters` | Medidores pre-exportación (LUFS / voz) |
| GET | `/api/export-profiles` | Listar perfiles de exportación (editables) |
| GET/PUT | `/api/export-profiles/{id}` | Ver / editar un perfil |
| POST | `/api/projects/{id}/reels/{reelId}/export-estimate` | Estimación aproximada de tamaño |
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
| GET | `/api/render-jobs/{id}/report` | Reporte JSON del render |
| POST | `/api/render-jobs/{id}/reveal` | Abrir carpeta del archivo (macOS/Windows/Linux) |

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
H.264 + AAC** real: corta cada ventana del video original, las une, puede
**quemar subtítulos ASS**, añade la **pantalla final obligatoria** y escribe un
reporte JSON verificado con FFprobe.

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
- Con `Normalizar audio` activo se aplica `alimiter` + `loudnorm` (objetivo
  configurable, por defecto ≈ −16 LUFS / TP −1.5 dBTP, valores prudentes para
  voz hablada) a la mezcla principal, para normalizar sonoridad y evitar clipping.

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

**Sincronía de audio:** cada Reel puede guardar un desfase entre −1000 y
+1000 ms. El mismo adelanto o retraso usado en la vista previa se aplica a la
exportación mediante entradas de audio independientes en FFmpeg.

## Pantalla final (obligatoria)

Todo Reel termina con una pantalla final. **No se puede desactivar**; la UI la
marca como `Obligatoria`. Dura entre **3 y 8 segundos** (por defecto 5 s, con
fade in de 300 ms y fade out del audio principal de 500 ms).

Muestra únicamente la portada de la predicación y, debajo, el texto «Ver sermón
completo en nuestro canal de YouTube». Ese mensaje es editable. No imprime el
título, nombre de la iglesia, identificador del canal, URL, logo ni código QR.
La UI permite escoger entre tres tratamientos:

| Diseño | Tratamiento de la portada |
|---|---|
| Imagen de fondo (recomendado) | Cubre todo el lienzo, sin márgenes ni franjas |
| Portada en tarjeta | Usa esquinas redondeadas |
| Minimalista | Presentación más compacta |

Los diseños de tarjeta y minimalista ajustan la portada completa dentro de su
espacio. El diseño de fondo llena el lienzo; si la relación de aspecto de la
portada es distinta a la del Reel, recorta únicamente el excedente necesario.

**Generación de la imagen:** se compone con **Pillow** y se guarda como PNG
temporal. No hay navegador ni motor headless de por medio: funciona sin red y en
cualquier equipo. Las tipografías son las **instaladas en el sistema**, igual que
en los subtítulos.

**Zonas seguras y texto:** la imagen y el único mensaje viven dentro del área
segura para que la UI de Shorts/Reels no los tape. El mensaje se ajusta a varias
líneas y reduce su tamaño si hace falta.

La pantalla final queda en silencio; el audio principal hace fade out antes de
mostrarla.

**Configuración global y por proyecto:** existe una fila global de
`EndCardSettings` (`project_id IS NULL`) y, opcionalmente, una fila por proyecto
que la sobrescribe. Desde la UI se puede guardar la configuración actual como
global o volver a heredarla.

**Concatenación:** la PNG entra como una entrada `-loop 1` y se une con `concat`
**después** de quemar los subtítulos, así que los tiempos de los cues siguen
siendo relativos al contenido principal.

## Música de fondo (opcional)

Desactivada por defecto (`preset=none`). La UI abre la Biblioteca de audio
oficial de YouTube Studio; el usuario descarga allí el MP3 y lo selecciona en la
app. También acepta un MP3, WAV, M4A u OGG local.

Advertencia mostrada en la UI:

> El usuario es responsable de contar con los derechos necesarios para utilizar este audio.

**Presets:** `none` · `very_soft_background` (volumen bajo + ducking).
Configurables: volumen, inicio/final del archivo, fade in/out, ducking y objetivo
LUFS. La pista nunca se repite: al terminar, el resto de la línea musical se
rellena con silencio.

**Mezcla:** con ducking, `sidechaincompress` baja la música cuando hay voz; el
`amix` prioriza la voz. Antes de exportar, la UI muestra medidores (LUFS,
margen de voz, riesgo de clipping).

## Perfiles de exportación

Perfiles editables (semilla inicial):

| Perfil | Lienzo | Notas |
|--------|--------|--------|
| YouTube Shorts | 1080×1920 · 9:16 | Máx. 60 s (configurable hasta 180). FPS original o 30. |
| Facebook Reels | 1080×1920 | Área segura para la UI de Facebook. |
| Instagram Reels | 1080×1920 | Safe area superior e inferior ampliada. |
| WhatsApp Status | 1080×1920 | Archivo más pequeño; fragmentación opcional. |

Calidad `draft` / `standard` / `high` con CRF configurable. Estimación de tamaño
antes de exportar. Nombre seguro:
`titulo-sermon_clip-01_youtube-short.mp4`. Tras el encode: verificación FFprobe
(falla sin audio, duración cero, resolución incorrecta o archivo corrupto),
hash SHA-256 y reporte JSON. Reproducir en la UI, abrir carpeta en el SO.
**Sin publicación automática.**

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
adicionales) y devuelve JSON validado por Pydantic. El ritmo editorial prioriza
un solo pasaje continuo; admite como máximo 3 fragmentos por Reel y exige por
defecto al menos 8 segundos por fragmento.

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
- `SERMON_CUT_AI_MAX_SEGMENTS_PER_REEL` — máximo de fragmentos/cortes por Reel
  sugerido (default `3`).
- `SERMON_CUT_AI_MIN_SEGMENT_SECONDS` — duración mínima de cada fragmento
  sugerido (default `8`).
- `SERMON_CUT_AI_MERGE_GAP_SECONDS` — une sugerencias casi consecutivas en un
  solo fragmento (default `1.25`).

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

## Escritorio (Tauri 2)

Empaquetado opcional sin reescribir backend/frontend. Guía:
[docs/DESKTOP.md](docs/DESKTOP.md).

```bash
./scripts/dev-desktop.sh      # ventana de escritorio (dev)
./scripts/build-desktop.sh    # genera .app + .dmg local
```

El `.app` incluye el backend Python autocontenido; FFmpeg/FFprobe permanecen
como dependencias del sistema. El flujo en navegador (`start-backend` +
`start-frontend`) sigue disponible.

## Diseño

- macOS / Windows / Linux, **local-first** (sin Docker ni Celery/Redis). Gemini y
  la descarga inicial de modelos Whisper son **opcionales** — ver
  [docs/PRIVACY.md](docs/PRIVACY.md).
- Rutas con `pathlib`; almacenamiento configurable (`SERMON_CUT_STORAGE_DIR`).
- El `<video>` usa la URL de stream; no se carga el archivo entero en memoria JS.
- Limitaciones conocidas: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
- Escritorio / Tauri: [docs/DESKTOP.md](docs/DESKTOP.md).
- Privacidad: [docs/PRIVACY.md](docs/PRIVACY.md).
- Licencias de terceros / FFmpeg: [docs/LICENSING.md](docs/LICENSING.md).
- Pendientes / checklist: [docs/PENDING.md](docs/PENDING.md).

## Comunidad

- [CONTRIBUTING.md](CONTRIBUTING.md) — cómo contribuir
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md) — reporte privado de vulnerabilidades
- [CHANGELOG.md](CHANGELOG.md)
- Plantillas de issues/PR y CI en `.github/`

## Licencia

[MIT](LICENSE).
