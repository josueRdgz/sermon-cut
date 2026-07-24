# Privacidad

Sermon Cut / Sermon Clips es una aplicación **local-first**: videos, transcripciones,
renders y la base SQLite viven en tu disco (`storage/` o `SERMON_CUT_STORAGE_DIR`).
**No hay sync en la nube integrado** ni telemetría propia del proyecto.

## Qué permanece en el dispositivo

- Archivos de video, carátulas, música de fondo y exports MP4.
- Transcripciones y metadatos del proyecto (SQLite).
- Modelos Whisper ya descargados (caché local; ver abajo).
- Clave Gemini, si la configuras, solo en `.env` / variables de entorno.

## Qué puede salir del dispositivo (opt-in)

| Función | Destino | Datos | Cómo evitarlo |
|---------|---------|-------|---------------|
| Análisis editorial / coherencia con Gemini | Google Generative AI | Texto de la transcripción (y metadatos del proyecto) | No configures `SERMON_CUT_GEMINI_API_KEY`; usa el mock local |
| Primera descarga de modelos Whisper | Hugging Face (caché) | Binarios del modelo, no tu sermón | Preinstala el modelo offline; la transcripción en sí es local |
| Importación desde YouTube (yt-dlp) | YouTube / Google | La URL del video que pegas; se descarga el video a tu disco | Deshabilita con `SERMON_CUT_YOUTUBE_IMPORT_ENABLED=false`; usa subida local |

## Importación desde YouTube (opcional)

- Es **opt-in** y requiere instalar `yt-dlp`. La subida de archivos locales sigue
  siendo el método principal y estable.
- Primera versión: **sin usuario, contraseña ni cookies**. Solo videos públicos o
  no listados accesibles sin autenticación. Nunca se extraen cookies del
  navegador; una futura opción de cookies exigiría tu consentimiento explícito.
- Solo se guarda en SQLite un subconjunto de metadatos (título, canal, duración,
  miniatura, resolución, fecha). **No** se almacena la respuesta JSON completa.
- Importa únicamente videos propios o para los que tengas autorización. Eres
  responsable de respetar los derechos de autor y las condiciones de YouTube.

La API local **no tiene autenticación** (diseño para `127.0.0.1`). No expongas el
puerto a la red. Ver [SECURITY.md](../SECURITY.md).

## Claims

Decir «100 % local» sin matices es incorrecto si usas Gemini, descargas Whisper o
importas desde YouTube. El producto es **local por defecto**; los servicios
externos son **opcionales y explícitos**.

## Claves API

- Guarda `SERMON_CUT_GEMINI_API_KEY` solo en `.env` (gitignored).
- No se expone en `/api/health` ni en el CLI `doctor` (solo “configurado: sí/no”).
- Revoca la clave en Google Cloud si sospechas filtración.
