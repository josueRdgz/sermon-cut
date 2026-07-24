# Regenerate the tiny CC0 demo clip with FFmpeg.
$ErrorActionPreference = "Stop"
$Out = Join-Path $PSScriptRoot "media\sample-clip.mp4"
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
ffmpeg -y `
  -f lavfi -i "color=c=0x1a365d:s=1280x720:d=4" `
  -f lavfi -i "sine=frequency=440:duration=4" `
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest `
  $Out
Write-Host "Wrote $Out"
