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

La API local **no tiene autenticación** (diseño para `127.0.0.1`). No expongas el
puerto a la red. Ver [SECURITY.md](../SECURITY.md).

## Claims

Decir «100 % local» sin matices es incorrecto si usas Gemini o descargas Whisper.
El producto es **local por defecto**; los servicios externos son **opcionales y
explícitos**.

## Claves API

- Guarda `SERMON_CUT_GEMINI_API_KEY` solo en `.env` (gitignored).
- No se expone en `/api/health` ni en el CLI `doctor` (solo “configurado: sí/no”).
- Revoca la clave en Google Cloud si sospechas filtración.
