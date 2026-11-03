# HRT AI Inspection System — Full-Stack Launcher
# Usage: .\start.ps1

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   HRT AI Inspection System — Full-Stack Launcher         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$Root = $PSScriptRoot

# 1. Start Backend Core REST API & Spatial Analytics (Port 3000)
Write-Host "[1/3] Starting HRT Backend REST API (Port 3000 / Spatial & Reports)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\backend'; Write-Host '--- HRT REST API & Spatial Engine (Port 3000) ---' -ForegroundColor Green; node src/index.js"

# 2. Start MongoDB Atlas Ingestion Gateway (Port 5000)
Write-Host "[2/3] Starting MongoDB Atlas Ingestion Gateway (Port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\api'; Write-Host '--- HRT MongoDB Gateway (Port 5000) ---' -ForegroundColor Magenta; node server.js"

# 3. Start Frontend Vite Dev Server (Port 5173)
Write-Host "[3/3] Starting React + Three.js Frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; Write-Host '--- HRT Frontend UI (Port 5173) ---' -ForegroundColor Cyan; npm run dev"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  ✅ All HRT Inspection Services launched in separate windows!" -ForegroundColor Green
Write-Host "  • Frontend UI        : http://localhost:5173" -ForegroundColor White
Write-Host "  • Core REST API      : http://localhost:3000 (Spatial, Reports & Detections)" -ForegroundColor White
Write-Host "  • MongoDB Gateway    : http://localhost:5000 (Live Atlas Telemetry)" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

