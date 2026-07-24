# Limitaciones actuales

Documento vivo de lo que **Sermon Cut / Sermon Clips** aún no hace o hace con
restricciones. Complementa el README.

## Producto

- **Sin publicación automática** a YouTube, Instagram, Facebook o WhatsApp.
  La exportación es solo local (MP4 + reporte JSON).
- **Sin catálogos de música** ni descarga automática de audio. Solo archivos
  locales del usuario (y el usuario debe tener derechos).
- El **análisis editorial con Gemini es opcional**. Sin clave se usa un mock
  determinista; no sustituye el criterio pastoral humano.
- Los **clips sugeridos no se aplican solos**: aceptación/rechazo explícitos.
- La **pantalla final es obligatoria** en cada render (no se puede desactivar).

## Plataforma y hardware

- Pensado para **uso local** en macOS, Windows y Linux. No requiere Docker.
  Hay un shell experimental **Tauri 2** ([docs/DESKTOP.md](DESKTOP.md)); el
  instalador aún depende del venv Python y de FFmpeg del sistema (no se
  empaquetan). Ver también [PRIVACY.md](PRIVACY.md) y [LICENSING.md](LICENSING.md).
- **faster-whisper** carga el audio del sermón completo a WAV temporal; videos
  muy largos consumen disco/RAM. Cancelación durante la extracción de audio ya
  termina FFmpeg; el chunking del modelo queda pendiente.
- Tests frontend siguen siendo mínimos (smoke); faltan contratos UI de
  subtítulos/render.
- El **tracking** de sujeto (OpenCV) es opcional y puede degradar a recorte
  central si falta el extra o falla el análisis.

## Media y calidad

- El render **siempre recodifica** (no hay `-c copy`); proyectos muy largos
  tardan y ocupan disco.
- La **estimación de tamaño** de exportación es heurística, no exacta.
- La **fragmentación WhatsApp** avisa / limita; no parte automáticamente el Reel
  en varios archivos todavía.
- FFmpeg/FFprobe deben estar en el `PATH`; builds mínimos sin `libx264`/`ass`
  no sirven para el pipeline completo.

## Datos y privacidad

- Videos, transcripciones, renders y la base SQLite viven en `storage/` (o
  `SERMON_CUT_STORAGE_DIR`). **No se suben a Git** y no hay sync en la nube
  integrada.
- No hay multi-usuario ni autenticación: quien pueda abrir `localhost` usa la
  app.

## Internacionalización

- La UI está principalmente en **español**. i18n completo no está implementado.

## Roadmap tentativo (no comprometido)

- Publicación asistida (OAuth) a plataformas, siempre opt-in.
- Instaladores nativos / actualización automática.
- Mejor partición automática para estados / Shorts muy largos.
- Más idiomas de interfaz.
