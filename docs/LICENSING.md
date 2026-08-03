# Licencias de terceros y FFmpeg

El código de Sermon Cut se publica bajo **MIT** ([LICENSE](../LICENSE)).
Eso **no** cubre herramientas del sistema que uses en runtime.

## FFmpeg (no empaquetado en v0)

La aplicación **invoca el `ffmpeg` / `ffprobe` del PATH**. En esta fase **no**
se redistribuyen binarios FFmpeg dentro del instalador Tauri (ver
[DESKTOP.md](DESKTOP.md)).

Motivos:

1. **Tamaño** del bundle.
2. **Licencias**: muchas builds de FFmpeg con `libx264` (y a veces otros codecs)
   se distribuyen bajo **GPL**. Redistribuir esos binarios obliga a cumplir la
   GPL (código fuente correspondiente, avisos, etc.). Builds **LGPL** existen
   pero con un conjunto de codecs distinto.

Si en el futuro se empaqueta FFmpeg:

- Elige conscientemente una build LGPL *o* acepta obligaciones GPL.
- Incluye avisos y fuentes según la licencia de esa build.
- Documenta la decisión en el instalador / NOTICE.

## Fuentes tipográficas

La UI usa `system-ui`. Subtítulos ASS y pantallas finales usan **fuentes ya
instaladas en el SO** (p. ej. Helvetica/Arial en macOS/Windows, Liberation o
DejaVu en Linux). **No** se incluyen TTF propietarios en el repositorio ni en el
bundle.

## yt-dlp (importación opcional desde YouTube)

La importación desde YouTube usa **`yt-dlp`**. La aplicación de escritorio lo
incluye dentro de su sidecar; en desarrollo se instala como dependencia Python.
`SERMON_CUT_YTDLP_PATH` permite seleccionar otro ejecutable explícitamente.
yt-dlp es software libre (**Unlicense**); su uso está sujeto a sus propios
términos y a las condiciones de la plataforma de origen.

Notas:

- La función es **opt-in**; la subida local es el método principal y el fallback
  estable.
- YouTube cambia sus mecanismos con frecuencia: genera una versión nueva de la
  aplicación para actualizar el `yt-dlp` incluido. Algunas URLs pueden dejar de
  funcionar temporalmente.
- Importa únicamente contenido propio o autorizado. La responsabilidad sobre los
  derechos de autor y los términos del servicio recae en la persona usuaria.
- La fusión de video/audio y la validación usan el `ffmpeg`/`ffprobe` del sistema
  (ver la sección de FFmpeg arriba).

## Dependencias Python / npm

La mayoría de dependencias declaradas son MIT/Apache-2.0. Antes de redistribuir
un instalador completo, genera un inventario (`pip-licenses`, `license-checker`)
y revisa especialmente cualquier componente copyleft.

## Demo

Los assets bajo `demo/` se documentan como **CC0** en su carpeta.
