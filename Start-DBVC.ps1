$ErrorActionPreference = 'Continue'
$DBVCRoot = 'C:\Users\dongliang\Documents\Codex\2026-06-22\ni\DBVC'
$CosyRoot = 'E:\DBVC\Models\CosyVoice'
$Url = 'http://127.0.0.1:3010/'

function Test-Http($UrlToTest) {
  try {
    $r = Invoke-WebRequest -Uri $UrlToTest -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

Write-Host '=========================================='
Write-Host ' DBVC Voice Studio Launcher'
Write-Host '=========================================='

if (-not (Test-Path $DBVCRoot)) {
  Write-Host "DBVC folder not found: $DBVCRoot" -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

if (-not (Test-Http 'http://127.0.0.1:50000/')) {
  Write-Host 'Starting CosyVoice2 backend. First startup may take 1-3 minutes...'
  $cosyPython = Join-Path $CosyRoot '.venv\Scripts\python.exe'
  if (-not (Test-Path $cosyPython)) {
    Write-Host "CosyVoice Python not found: $cosyPython" -ForegroundColor Red
  } else {
    Start-Process -FilePath $cosyPython -ArgumentList 'api_server.py' -WorkingDirectory $CosyRoot -WindowStyle Minimized
  }
} else {
  Write-Host 'CosyVoice2 backend is already running.'
}

if (-not (Test-Http $Url)) {
  Write-Host 'Starting DBVC web server...'
  $node = 'C:\Program Files\nodejs\node.exe'
  if (-not (Test-Path $node)) { $node = 'node.exe' }
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $DBVCRoot -WindowStyle Minimized
} else {
  Write-Host 'DBVC web server is already running.'
}

Write-Host 'Waiting for DBVC web server...'
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Http $Url) { break }
  Start-Sleep -Seconds 1
}

if (Test-Http $Url) {
  Start-Process $Url
  Write-Host "Opened: $Url"
} else {
  Write-Host 'DBVC web server did not start. Please check Node.js and server.js.' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

Write-Host 'Done. You can close this window.'
Start-Sleep -Seconds 3