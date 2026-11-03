# HRT AI Inspection System — Unified Full-Stack Launcher
# Usage:
#   .\start.ps1                   # Launches Primary API (Port 3000) & Frontend UI (Port 5173)
#   .\start.ps1 -WithLegacyApi    # Also launches secondary MongoDB Gateway (Port 5000)
#   .\start.ps1 -SkipPortCheck    # Bypass initial port availability checks
#   .\start.ps1 -DryRun           # Print configuration and preflight checks without launching processes

[CmdletBinding()]
param(
    [switch]$WithLegacyApi,
    [switch]$SkipPortCheck,
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot

function Test-PortInUse([int]$Port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $wait = $iar.AsyncWaitHandle.WaitOne(400, $false)
        if ($wait) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
        return $false
    } catch {
        return $false
    }
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   HRT AI INSPECTION SYSTEM -- UNIFIED FULL-STACK LAUNCHER        " -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

# -- Port Preflight Checks ----------------------------------------------------
if (-not $SkipPortCheck) {
    Write-Host "[*] Checking port availability..." -ForegroundColor DarkGray
    $port3000InUse = Test-PortInUse 3000
    $port5173InUse = Test-PortInUse 5173
    $port5000InUse = Test-PortInUse 5000

    if ($port3000InUse) {
        Write-Host "  [!] Port 3000 is active: Primary REST API may already be running." -ForegroundColor Yellow
    } else {
        Write-Host "  [+] Port 3000 available: Ready for Primary REST API." -ForegroundColor Green
    }

    if ($port5173InUse) {
        Write-Host "  [!] Port 5173 is active: Frontend dev server may already be running." -ForegroundColor Yellow
    } else {
        Write-Host "  [+] Port 5173 available: Ready for Frontend Vite Dev Server." -ForegroundColor Green
    }

    if ($port5000InUse) {
        Write-Host "  [i] Port 5000 is active: Secondary MongoDB Gateway detected." -ForegroundColor DarkGray
    } else {
        Write-Host "  [i] Port 5000 available: Secondary Service ready." -ForegroundColor DarkGray
    }
    Write-Host ""
}

# -- 1. Start Primary Backend REST API (Port 3000) ---------------------------
Write-Host "[1/2] Starting Primary Backend REST API (Port 3000)..." -ForegroundColor Yellow
Write-Host "      Endpoints: /api/detections, /api/inspections, /api/spatial-summary, /api/reports" -ForegroundColor DarkGray
$backendCmd = "cd '$Root\backend'; `$Host.UI.RawUI.WindowTitle = 'HRT Primary Backend (Port 3000)'; Write-Host '=== HRT Primary REST API & Spatial Engine (Port 3000) ===' -ForegroundColor Green; node src/index.js"
if (-not $DryRun) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
} else {
    Write-Host "      [DRY-RUN] Command: $backendCmd" -ForegroundColor DarkYellow
}

# -- 2. Start Frontend Vite Dev Server (Port 5173) ---------------------------
Write-Host "[2/2] Starting Frontend Vite Dev Server (Port 5173)..." -ForegroundColor Yellow
Write-Host "      Stack: React 18, Three.js WebGL Twin, Tailwind CSS" -ForegroundColor DarkGray
$frontendCmd = "cd '$Root\frontend'; `$Host.UI.RawUI.WindowTitle = 'HRT Frontend UI (Port 5173)'; Write-Host '=== HRT React + Three.js Frontend (Port 5173) ===' -ForegroundColor Cyan; npm run dev"
if (-not $DryRun) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd
} else {
    Write-Host "      [DRY-RUN] Command: $frontendCmd" -ForegroundColor DarkYellow
}

# -- Optional: Secondary / Legacy MongoDB Ingestion Gateway (Port 5000) -------
if ($WithLegacyApi) {
    Write-Host "[Optional] Starting Secondary MongoDB Ingestion Gateway (Port 5000)..." -ForegroundColor Magenta
    $legacyCmd = "cd '$Root\api'; `$Host.UI.RawUI.WindowTitle = 'HRT Legacy MongoDB Gateway (Port 5000)'; Write-Host '=== HRT MongoDB Gateway (Port 5000) ===' -ForegroundColor Magenta; node server.js"
    if (-not $DryRun) {
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $legacyCmd
    } else {
        Write-Host "      [DRY-RUN] Command: $legacyCmd" -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  HRT Inspection Services Launched Successfully!" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  * Frontend UI        : http://localhost:5173" -ForegroundColor White
Write-Host "  * Primary REST API   : http://localhost:3000" -ForegroundColor White
Write-Host "    - Health Check     : http://localhost:3000/health" -ForegroundColor DarkGray
Write-Host "    - Spatial Summary  : http://localhost:3000/api/spatial-summary" -ForegroundColor DarkGray
Write-Host "    - Inspections API  : http://localhost:3000/api/inspections" -ForegroundColor DarkGray
Write-Host "    - Detections API   : http://localhost:3000/api/detections" -ForegroundColor DarkGray
Write-Host "    - Reports API      : http://localhost:3000/api/reports/generate" -ForegroundColor DarkGray
Write-Host "  * Secondary Service  : http://localhost:5000 (api/server.js)" -ForegroundColor DarkCyan
Write-Host "    - MongoDB Gateway  : Optional / Legacy cloud telemetry ingestion" -ForegroundColor DarkGray
if (-not $WithLegacyApi) {
    Write-Host "    - Note             : Pass '-WithLegacyApi' to also launch port 5000" -ForegroundColor DarkGray
}
Write-Host "------------------------------------------------------------------" -ForegroundColor Green
Write-Host "  Graceful Shutdown Instructions:" -ForegroundColor Yellow
Write-Host "     - Close each PowerShell window, or press Ctrl+C in the terminal." -ForegroundColor Gray
Write-Host "     - Or run: Get-Process node -ErrorAction SilentlyContinue | Stop-Process" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""
