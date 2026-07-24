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

## Dependencias Python / npm

La mayoría de dependencias declaradas son MIT/Apache-2.0. Antes de redistribuir
un instalador completo, genera un inventario (`pip-licenses`, `license-checker`)
y revisa especialmente cualquier componente copyleft.

## Demo

Los assets bajo `demo/` se documentan como **CC0** en su carpeta.
