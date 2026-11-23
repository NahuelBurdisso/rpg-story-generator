# RPG Story Generator - one-click launcher
# Boots ComfyUI (docker), Ollama (native), narrator model, Next dev server, opens browser.

# NOT "Stop": native exes (docker/ollama/npm) writing to stderr become
# terminating NativeCommandErrors under Stop in PS 5.1, killing the launcher.
# We check $LASTEXITCODE explicitly instead.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$Model = "gemma3:12b"
$Ollama = "D:\Ollama\ollama.exe"

function Wait-Url($url, $name, $timeout = 180) {
  Write-Host "Waiting for $name..." -NoNewline
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $timeout) {
    try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Host " ready."; return $true }
    catch { Start-Sleep 2; Write-Host "." -NoNewline }
  }
  Write-Host " TIMEOUT."; return $false
}

Set-Location $Root
Write-Host "=== RPG Story Generator ===" -ForegroundColor Cyan

# 0. Docker Desktop - start engine if not running
$DockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
docker info *>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Starting Docker Desktop..."
  Start-Process -FilePath $DockerDesktop
  Write-Host "Waiting for Docker engine..." -NoNewline
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 180) {
    docker info *>$null
    if ($LASTEXITCODE -eq 0) { Write-Host " ready."; break }
    Start-Sleep 3; Write-Host "." -NoNewline
  }
  if ($LASTEXITCODE -ne 0) { Write-Host " TIMEOUT - ComfyUI may not start." }
} else { Write-Host "Docker already running." }

# 1. ComfyUI via docker
Write-Host "Starting ComfyUI (docker)..."
docker compose up -d comfyui

# 2. Ollama (native) - start serve if not already up
try { Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Host "Ollama already running." }
catch {
  Write-Host "Starting Ollama..."
  Start-Process -FilePath $Ollama -ArgumentList "serve" -WindowStyle Hidden
}
Wait-Url "http://localhost:11434/api/tags" "Ollama" | Out-Null

# 3. Narrator model
$have = & $Ollama list 2>$null | Select-String -SimpleMatch $Model
if (-not $have) {
  Write-Host "Pulling $Model (first run, large)..."
  & $Ollama pull $Model
} else { Write-Host "Model present: $Model" }

# 4. ComfyUI ready (non-fatal if slow)
Wait-Url "http://localhost:8188/system_stats" "ComfyUI" 120 | Out-Null

# 5. Next dev server in its own window
Write-Host "Starting app (npm run dev)..."
Start-Process -FilePath "powershell" -ArgumentList "-NoExit","-Command","Set-Location '$Root'; npm run dev"

# 6. Open browser when up
if (Wait-Url "http://localhost:3000" "app" 120) { Start-Process "http://localhost:3000" }

Write-Host "`n=== Running ===" -ForegroundColor Green
Write-Host "  App:     http://localhost:3000"
Write-Host "  Ollama:  http://localhost:11434"
Write-Host "  ComfyUI: http://localhost:8188"
Write-Host "Close the 'npm run dev' window to stop the app."
