# Serves the built game (dist/) on http://localhost:8750 and opens it. Starts the server only if needed.
$port = 8750
$dist = (Resolve-Path (Join-Path $PSScriptRoot '..\dist')).Path
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -WindowStyle Hidden python -ArgumentList '-m', 'http.server', "$port", '--directory', "$dist"
  Start-Sleep -Milliseconds 900
}
Start-Process "http://localhost:$port/"
