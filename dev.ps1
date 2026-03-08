# dev.ps1 (ejecutar desde la raíz del repo)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Backend (FastAPI)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$root`"; .\.venv\Scripts\Activate.ps1; uvicorn api.main:app --reload --port 8000"

# Frontend (Next)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$root\web`"; npm run dev"