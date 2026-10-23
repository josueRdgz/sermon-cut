# Instalador de escritorio

El `.dmg` pesa ~214 MB, por encima del límite de GitHub para git. Se publica
en **Releases** del repositorio, no dentro del historial.

Tras `./scripts/build-desktop.sh` (o el bundle de Tauri):

```text
…/bundle/dmg/Sermon Cut_0.4.12_aarch64.dmg
→ releases/Sermon Cut_0.4.12_aarch64.dmg
```

En la Mac de destino: descarga el DMG de la release, ábrelo e instala
**Sermon Cut** en `/Applications`. Hace falta FFmpeg/FFprobe. Sin notarización:
clic secundario → **Abrir**.
