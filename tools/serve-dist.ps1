# Serves the built game (dist/) on http://localhost:8750 and opens it. Starts the server only if needed.
# The server keeps running in the background after the browser closes (same as the old
# `python -m http.server` launcher) -- stop it by closing its python process.
# Uses serve-dist.py (not `python -m http.server` directly) because that stock command
# binds every interface by default and its MIME guessing is unreliable across machines --
# see docs/progress/phase1.md and task-11-report.md for the measurements. serve-dist.py
# binds 127.0.0.1 only and fixes the .webp/.js content types.
$port = 8750
$dist = (Resolve-Path (Join-Path $PSScriptRoot '..\dist')).Path
$server = Join-Path $PSScriptRoot 'serve-dist.py'
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -WindowStyle Hidden python -ArgumentList "$server", "$port", "$dist"
  Start-Sleep -Milliseconds 900
}
Start-Process "http://localhost:$port/"
