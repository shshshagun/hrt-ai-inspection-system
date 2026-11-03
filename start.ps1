# HRT AI Inspection System — Full-Stack Launcher
# Usage: .\start.ps1

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   HRT AI Inspection System — Full-Stack Launcher         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$Root = $PSScriptRoot

# 1. Start Backend API in a separate terminal window
Write-Host "[1/2] Starting Backend API Server (Port 5000 / MongoDB)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\api'; Write-Host '--- HRT API Server ---' -ForegroundColor Green; node server.js"

# 2. Start Frontend Vite Dev Server in a separate terminal window
Write-Host "[2/2] Starting React + Three.js Frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; Write-Host '--- HRT Frontend UI ---' -ForegroundColor Cyan; npm run dev"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  ✅ Both Backend and Frontend launched in separate windows!" -ForegroundColor Green
Write-Host "  • Frontend UI : http://localhost:5173" -ForegroundColor White
Write-Host "  • Backend API : http://localhost:5000" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

