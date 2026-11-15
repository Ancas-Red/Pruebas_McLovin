param(
    [switch]$Fixtures,
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$PythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python"
}

$ProcessedTerr = Join-Path $RepoRoot "data\processed\territories.geojson"
if ($Fixtures -or -not (Test-Path $ProcessedTerr)) {
    $env:MCHANAQ_DATA_DIR = "data/fixtures"
    $env:MCHANAQ_NO_CACHE = "1"
    Write-Host "[McHanaq] Backend usando data/fixtures (MCHANAQ_NO_CACHE=1)" -ForegroundColor Yellow
} else {
    Remove-Item Env:MCHANAQ_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:MCHANAQ_NO_CACHE -ErrorAction SilentlyContinue
    Write-Host "[McHanaq] Backend usando data/processed (Ucayali + Fase 2)" -ForegroundColor Green
}

Write-Host "[McHanaq] Iniciando Backend en http://localhost:$BackendPort ..." -ForegroundColor Cyan
$BackendCmd = "Set-Location '$RepoRoot'; & '$PythonExe' -m uvicorn src.backend.app.main:app --reload --port $BackendPort"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $BackendCmd

$FrontendDir = Join-Path $RepoRoot "src\frontend"
Write-Host "[McHanaq] Iniciando Frontend en http://localhost:$FrontendPort ..." -ForegroundColor Cyan
$FrontendCmd = "Set-Location '$FrontendDir'; npm.cmd run dev -- --port $FrontendPort"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $FrontendCmd
