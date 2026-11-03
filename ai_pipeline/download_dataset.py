"""
download_dataset.py
-------------------
Downloads and extracts the Underwater Crack Detection dataset from Roboflow Universe
for the HRT AI Inspection System YOLOv8 training pipeline.

Dataset: rov-crack-detection-3o91d/underwater-crack-detection
Format : YOLOv8 object detection format (data.yaml, train/, valid/, test/)

Usage:
    # Using CLI argument:
    python ai_pipeline/download_dataset.py --api-key YOUR_API_KEY

    # Using environment variable:
    # Windows PowerShell: $env:ROBOFLOW_API_KEY="YOUR_API_KEY"
    # Linux / macOS   : export ROBOFLOW_API_KEY="YOUR_API_KEY"
    python ai_pipeline/download_dataset.py

    # Specific version or target folder:
    python ai_pipeline/download_dataset.py --version 1 --dest data
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DEST = ROOT / "data"
DEFAULT_WORKSPACE = "rov-crack-detection-3o91d"
DEFAULT_PROJECT = "underwater-crack-detection"
DEFAULT_VERSION = 1
DEFAULT_FORMAT = "yolov8"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Download Underwater Crack Detection dataset from Roboflow Universe."
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("ROBOFLOW_API_KEY"),
        help="Roboflow private API key (default: read from ROBOFLOW_API_KEY env var)",
    )
    parser.add_argument(
        "--workspace",
        default=DEFAULT_WORKSPACE,
        help=f"Roboflow workspace slug (default: '{DEFAULT_WORKSPACE}')",
    )
    parser.add_argument(
        "--project",
        default=DEFAULT_PROJECT,
        help=f"Roboflow project slug (default: '{DEFAULT_PROJECT}')",
    )
    parser.add_argument(
        "--version",
        type=int,
        default=DEFAULT_VERSION,
        help=f"Dataset export version (default: {DEFAULT_VERSION})",
    )
    parser.add_argument(
        "--format",
        default=DEFAULT_FORMAT,
        help=f"Export format for YOLO (default: '{DEFAULT_FORMAT}')",
    )
    parser.add_argument(
        "--dest",
        default=str(DEFAULT_DEST),
        help=f"Destination directory for dataset (default: '{DEFAULT_DEST}')",
    )
    return parser.parse_args()


def print_missing_key_guidance():
    msg = """
======================================================================
[!] ROBOFLOW API KEY REQUIRED
======================================================================
To download the Underwater Crack Detection dataset from Roboflow:

1. Obtain your free private API key from:
   https://universe.roboflow.com/rov-crack-detection-3o91d/underwater-crack-detection
   (Roboflow Settings -> Roboflow API -> Private API Key)

2. Provide the API key using one of the following methods:

   Method A - Command Line Argument:
     python ai_pipeline/download_dataset.py --api-key YOUR_API_KEY

   Method B - Environment Variable:
     Windows PowerShell:
       $env:ROBOFLOW_API_KEY="YOUR_API_KEY"
       python ai_pipeline/download_dataset.py

     Windows Command Prompt (CMD):
       set ROBOFLOW_API_KEY=YOUR_API_KEY
       python ai_pipeline/download_dataset.py

     Linux / macOS (Bash / Zsh):
       export ROBOFLOW_API_KEY="YOUR_API_KEY"
       python ai_pipeline/download_dataset.py

Note: If you already have the dataset downloaded under 'data/',
you can directly verify or train using:
     python ai_pipeline/train.py --data data/data.yaml
======================================================================
"""
    print(msg)


def download_dataset(api_key: str, workspace: str, project: str, version_num: int, fmt: str, dest_dir: Path):
    print("=" * 70)
    print("  HRT AI Inspection - Roboflow Dataset Ingestion")
    print("=" * 70)
    print(f"  Workspace   : {workspace}")
    print(f"  Project     : {project}")
    print(f"  Version     : {version_num}")
    print(f"  Format      : {fmt}")
    print(f"  Destination : {dest_dir}")
    print("=" * 70)

    try:
        from roboflow import Roboflow
    except ImportError:
        print("[FAIL] The 'roboflow' Python package is not installed.")
        print("       Install it with: pip install roboflow")
        return False

    dest_dir.mkdir(parents=True, exist_ok=True)

    try:
        print(f"[+] Initializing Roboflow client...")
        rf = Roboflow(api_key=api_key)
        print(f"[+] Accessing project '{workspace}/{project}'...")
        rf_project = rf.workspace(workspace).project(project)
        print(f"[+] Fetching dataset version {version_num}...")
        dataset_version = rf_project.version(version_num)
        print(f"[+] Downloading '{fmt}' dataset archive to: {dest_dir}...")
        dataset = dataset_version.download(model_format=fmt, location=str(dest_dir))
        print(f"[OK] Dataset successfully downloaded to: {dataset.location}")
        return True
    except Exception as exc:
        print(f"[FAIL] Error downloading dataset from Roboflow: {exc}")
        return False


def main():
    args = parse_args()

    api_key = args.api_key or os.environ.get("ROBOFLOW_API_KEY")
    if not api_key:
        print_missing_key_guidance()
        sys.exit(1)

    dest_dir = Path(args.dest).resolve()
    success = download_dataset(
        api_key=api_key,
        workspace=args.workspace,
        project=args.project,
        version_num=args.version,
        fmt=args.format,
        dest_dir=dest_dir,
    )
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
