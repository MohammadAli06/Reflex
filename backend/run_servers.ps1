# Run both Mock API (port 8000) and Control API (port 8001) in separate windows or via Python runner

param (
    [switch]$SeparateWindows
)

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $backendDir

$python = "$backendDir\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}

if ($SeparateWindows) {
    Write-Host "Opening Mock API (Port 8000) in new window..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; & '$python' -m uvicorn app.mock_api.main:app --port 8000 --reload"

    Write-Host "Opening Control API (Port 8001) in new window..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; & '$python' -m uvicorn app.control_api.main:app --port 8001 --reload"
} else {
    Write-Host "Starting both servers simultaneously in this console..." -ForegroundColor Green
    & $python run_servers.py --reload
}
