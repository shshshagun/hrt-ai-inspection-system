# HRT AI Inspection System — PowerShell Quickstart
# Run from the project root:  .\run.ps1

param(
    [string]$Step = "all",   # all | download | train | evaluate | predict
    [string]$Source = "",    # video/image path for predict step
    [switch]$NoApi           # skip REST API posting during predict
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  HRT AI Inspection System — Pipeline Runner"    -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

function Check-Python {
    try { python --version | Out-Null; return $true }
    catch { Write-Host "ERROR: Python not found. Install Python 3.10+." -ForegroundColor Red; exit 1 }
}

function Install-Deps {
    Write-Host "[1/4] Installing Python dependencies..." -ForegroundColor Yellow
    python -m pip install -r ai_pipeline\requirements.txt
    Write-Host "  ✅ Dependencies installed." -ForegroundColor Green
}

function Download-Dataset {
    Write-Host "[2/4] Downloading dataset from Roboflow..." -ForegroundColor Yellow
    python download_dataset.py
    Write-Host "  ✅ Dataset ready in data\." -ForegroundColor Green
}

function Train-Model {
    Write-Host "[3/4] Training YOLOv8s model..." -ForegroundColor Yellow
    python ai_pipeline\train.py
    Write-Host "  ✅ Training complete. Weights → runs\detect\hrt_crack_det\weights\best.pt" -ForegroundColor Green
}

function Evaluate-Model {
    Write-Host "[4/4] Evaluating model on test split..." -ForegroundColor Yellow
    python ai_pipeline\evaluate.py --split test
    Write-Host "  ✅ Evaluation report → runs\evaluate\" -ForegroundColor Green
}

function Run-Predict {
    if ($Source -eq "") {
        Write-Host "ERROR: Provide --Source path/to/video.mp4 for the predict step." -ForegroundColor Red
        exit 1
    }
    Write-Host "[*] Running inference on: $Source" -ForegroundColor Yellow
    $NoApiFlag = if ($NoApi) { "--no-api" } else { "" }
    python ai_pipeline\predict.py --source $Source $NoApiFlag
    Write-Host "  ✅ Inference complete. Output → runs\predictions\" -ForegroundColor Green
}

Check-Python

switch ($Step.ToLower()) {
    "all" {
        Install-Deps
        Download-Dataset
        Train-Model
        Evaluate-Model
    }
    "install" { Install-Deps }
    "download" { Download-Dataset }
    "train"    { Train-Model }
    "evaluate" { Evaluate-Model }
    "predict"  { Run-Predict }
    default {
        Write-Host "Unknown step: $Step" -ForegroundColor Red
        Write-Host "Valid steps: all | install | download | train | evaluate | predict"
        exit 1
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  All done!" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
