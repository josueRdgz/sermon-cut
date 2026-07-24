# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `0.1.x` (main) | Yes |

## Reporting a vulnerability

Sermon Cut runs **locally** and may hold sermon videos, transcripts, and API
keys on disk. Please report security issues **privately**:

1. Prefer [GitHub Security Advisories](https://github.com/josueRdgz/sermon-cut/security/advisories/new)
   for this repository, **or**
2. Email the maintainer listed on the GitHub profile of the repo owner.

Include:

- A short description of the issue and impact
- Steps to reproduce (proof of concept if possible)
- Affected version / commit

Please **do not** open a public issue for vulnerabilities that could expose
local media, transcripts, Gemini keys, or allow remote code execution.

We aim to acknowledge reports within **7 days** and to publish a fix or
mitigation as soon as practical.

## What is out of scope

- Social-engineering of individual users’ machines
- Issues that only affect intentionally insecure local misconfiguration
  (e.g. world-writable `SERMON_CUT_STORAGE_DIR` on a shared host)
- Denial of service against a user’s own `uvicorn` process

## Optional YouTube import (yt-dlp)

The YouTube import feature is **opt-in** and off unless you enable it and install
`yt-dlp`. Local file upload is always the primary, stable path. When it is used:

- URLs are validated for **syntax and domain** before any subprocess runs. Only
  `youtube.com` / `youtu.be` single-video URLs are accepted. Playlists,
  channels, search pages, `file://`, `localhost`, and private/internal hosts are
  rejected (SSRF protection).
- `yt-dlp` runs with `subprocess.Popen`, an **explicit argument list**, and
  `shell=False`. **No argument is ever taken from the frontend** — only the
  validated canonical URL and a backend-defined quality. `--ignore-config` is
  used so a local `yt-dlp` config cannot inject flags, and `--no-playlist`
  enforces single-video downloads.
- The first version uses **no cookies and no credentials** (`--no-cookies`); only
  public/unlisted videos accessible without auth are supported. Browser-cookie
  auth is intentionally **not** implemented and would require explicit user
  consent in a future version.
- Raw `yt-dlp` output (which can contain absolute paths or command lines) is kept
  in a **local log file only**; the API returns stable error codes and safe
  messages, never cookies, full commands, or absolute paths.
- Downloads are bounded by configurable **max duration**, **max estimated size**,
  and a **free-disk** check before starting. Cancellation terminates the process
  and removes `.part` / incomplete files without touching a previously valid
  video.

Because YouTube changes its mechanisms frequently, keep `yt-dlp` updated
(`pip install -U yt-dlp`). Some URLs may temporarily fail; local upload remains
the reliable fallback.

## Hardening tips for operators

- Keep `.env` out of Git (already gitignored).
- Do not expose the API (`127.0.0.1:8000`) to the public internet without auth.
  There is **no application-level authentication** by design; any local process
  that can reach the port can read/delete projects. Prefer the Tauri shell or
  bind only to loopback.
- Treat sermon media and transcripts as sensitive pastoral data.
- See [docs/PRIVACY.md](docs/PRIVACY.md) for optional Gemini / Hugging Face flows.
- Treat `storage/` as sensitive; back it up privately.
- Never commit Whisper weights, renders, or SQLite databases.
