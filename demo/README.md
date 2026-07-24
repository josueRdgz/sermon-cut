# Datos de demostración

Contenido **pequeño**, **sintético** y **libre de derechos de terceros**, pensado
para probar la instalación local sin subir predicaciones reales.

## Licencia del material demo

Todo lo que hay en esta carpeta se publica bajo **CC0 1.0 Universal** (dominio
público): puedes copiarlo, modificarlo y usarlo sin atribución.

- El video `media/sample-clip.mp4` es un patrón de color + tono generado con
  FFmpeg (`lavfi`), no contiene voz ni obras de terceros.
- Los archivos de transcripción son texto **original** inventado para la demo
  (no citan sermones reales ni material protegido).

## Contenido

| Archivo | Uso |
|---------|-----|
| `media/sample-clip.mp4` | Clip de ~4 s (1280×720) para crear un proyecto de prueba |
| `sample-transcript.srt` | Transcripción SRT alineada al clip |
| `sample-transcript.json` | Misma transcripción en formato JSON interno |
| `generate-sample-media.sh` / `.ps1` | Regenerar el MP4 si lo borras |

## Cómo usarlo

1. Arranca backend y frontend.
2. Crea un proyecto y sube `demo/media/sample-clip.mp4`.
3. Importa `demo/sample-transcript.srt` (o el JSON).
4. Crea un Reel corto y prueba el render.

No uses esta carpeta para videos o transcripciones personales: esos datos deben
quedarse en `storage/` (ignorado por Git).
