# Pendientes — Sermon Cut / Sermon Clips

Documento operativo de **lo que ya quedó resuelto** en la auditoría y **lo que
tú (o un próximo ciclo) debéis hacer**. Complementa
[LIMITATIONS.md](LIMITATIONS.md), [PRIVACY.md](PRIVACY.md) y
[LICENSING.md](LICENSING.md).

Última actualización: 2026-07-24.

---

## Checklist rápida (hazlo tú en la máquina)

### Cada vez que clones / actualices

- [ ] `./scripts/setup-macos.sh` **o** `setup-linux.sh` **o** `setup-windows.ps1`
- [ ] Copia `.env.example` → `.env` y rellena solo lo que uses
- [ ] Instala **FFmpeg + FFprobe** en el PATH (no se empaquetan)
- [ ] `cd backend && .venv/bin/python -m app.cli doctor`
- [ ] Arranque navegador: `./scripts/start-backend.sh` + `./scripts/start-frontend.sh`

### Escritorio (opcional)

- [ ] Instalar [Rust / rustup](https://rustup.rs/)
- [ ] `./scripts/dev-desktop.sh` (dev) o `./scripts/build-desktop.sh` (build local)
- [ ] Recordar: el `.app`/instalador **aún necesita** `backend/.venv` + FFmpeg del sistema

### Si usas Gemini

- [ ] Leer [PRIVACY.md](PRIVACY.md) — el texto del sermón sale a Google
- [ ] `SERMON_CUT_GEMINI_API_KEY` solo en `.env` (nunca en Git)
- [ ] `pip install -e ".[gemini]"` en el venv del backend

### Antes de compartir un export

- [ ] Revisar unión del Reel (coherencia) y **sentido pastoral** del corte
- [ ] Previsualizar subtítulos tras varios segmentos / crossfades
- [ ] No publicar automáticamente (la app no lo hace; eres tú quien sube)

### Storage

- [ ] Preferir `SERMON_CUT_STORAGE_DIR` **fuera de iCloud Drive** si el repo vive en
      `Mobile Documents` (locks SQLite / sync)

---

## Hallazgos de auditoría — estado

### Resueltos en código (no requieren acción tuya)

| ID | Tema | Estado |
|----|------|--------|
| C1 | SQLite `foreign_keys` + WAL | Hecho |
| C2 | Jobs huérfanos al reiniciar | Hecho |
| C3 | Estado de proyecto multi-render | Hecho |
| C4 | Claim «100% local» engañoso | Hecho (docs + UI) |
| A1 | Cancel Whisper durante extract | Hecho |
| A2 | Lifespan shutdown managers | Hecho |
| A4 | Aviso Gemini en UI | Hecho |
| A5 | Doc FFmpeg/GPL | Hecho (`LICENSING.md`) |
| A6 | Fuentes Win/Linux | Hecho |
| A7 | README obsoleto subtítulos | Hecho |
| A8 | Disclaimer pastoral en export | Hecho |
| A9 | Karaoke gaps ASS | Hecho |
| A10 | Cues duplicados en crossfade | Hecho |
| A11 | Cancel en verify/finalize | Hecho |
| A12 | ErrorBoundary + modal Escape | Hecho |
| M1 | Límites cover/música + magic bytes | Hecho |
| M2 | WAL / busy_timeout | Hecho |
| M3 | Rutas absolutas en report/reveal/API | Hecho (basename + redact) |
| B1 | Whitelist `-preset` x264 | Hecho |

### Pendientes (tú / siguiente ciclo de desarrollo)

#### Prioridad alta (producto / seguridad local)

1. **Auth local entre Tauri y FastAPI**  
   Hoy no hay token: cualquier proceso en la máquina que hable a `127.0.0.1`
   puede usar la API.  
   *Qué hacer:* token one-shot generado por el host Rust e inyectado en la UI;
   o Unix socket / named pipe. Documentado en `SECURITY.md`.

2. **Sidecar Python embebido (PyInstaller u otro)**  
   El build Tauri aún depende del venv del repo.  
   *Qué hacer:* empaquetar backend + deps; seguir **sin** bundlear FFmpeg hasta
   revisar GPL ([LICENSING.md](LICENSING.md)).

3. **Firma / notarización**  
   macOS Gatekeeper y Windows SmartScreen.  
   *Qué hacer:* certificados Apple/Windows + pipeline de firma (cuando publiques).

#### Prioridad media (calidad / rendimiento)

4. **Whisper: chunking / no WAV completo del sermón**  
   Videos largos → mucho disco/RAM. Cancel en extract ya funciona; falta partir
   audio o pipe.

5. **Evicción de modelos Whisper en memoria**  
   `_models` cachea sin límite.

6. **Tracking: un FFmpeg por frame**  
   Batchear a `fps` → secuencia de imágenes.

7. **Semáforo global** entre render / whisper / analysis  
   Hoy pueden correr los tres a la vez.

8. **mypy / pyright en CI**  
   Tipado Python no está en el pipeline.

9. **Más tests frontend**  
   Solo smoke (`App`, `ProjectsPage`). Faltan RenderPanel, SubtitlePanel,
   ConfirmDialog, coherencia.

10. **Tests API** de `subtitle-preview`, framing HTTP, background-music HTTP  
    (hay tests de filtros/unitarios; faltan contratos HTTP completos).

11. **Scripts PowerShell** para `dev-desktop` / `build-desktop`  
    Hoy solo `.sh`.

12. **`auto_migrate` estricto en “prod”**  
    Hoy un fallo de migración no aborta el arranque. Opción: env
    `SERMON_CUT_AUTO_MIGRATE_STRICT=true`.

#### Prioridad baja / backlog

13. Inventario de licencias npm/pip en CI (`pip-licenses`, `license-checker`).
14. ProgressBar ARIA completo (`role="progressbar"`).
15. Contraste WCAG de textos muted en UI oscura.
16. Reducir `blurred_background` / crop expressions anidadas en FFmpeg.
17. Quarantine de MP4 fallidos de verify (borrar o mover a `.failed`).
18. Cache Hugging Face bajo `SERMON_CUT_STORAGE_DIR` (documentar path real).

---

## No hacer todavía (decidido)

- Publicar releases automáticos en GitHub.
- Empaquetar FFmpeg dentro del instalador sin revisión legal.
- Publicación automática a YouTube / Instagram / etc.
- Reescribir backend o frontend “para desktop”.

---

## Cómo verificar que el árbol está limpio

```bash
cd backend && .venv/bin/ruff check app tests
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run lint && npx tsc --noEmit && npm test && npm run build
```

Si algo falla, no ignores el rojo: abre issue o corrige antes de merge.

---

## Referencias

| Documento | Uso |
|-----------|-----|
| [DESKTOP.md](DESKTOP.md) | Tauri, build local |
| [PRIVACY.md](PRIVACY.md) | Qué sale del dispositivo |
| [LICENSING.md](LICENSING.md) | FFmpeg / fuentes / deps |
| [LIMITATIONS.md](LIMITATIONS.md) | Límites de producto |
| [SECURITY.md](../SECURITY.md) | Reportes y endurecimiento |
| [CHANGELOG.md](../CHANGELOG.md) | Cambios por versión |
