"""
download_dataset.py
-------------------
Downloads the full Underwater Crack Detection dataset from Roboflow
(workspace: rov-crack-detection-3o91d, project: underwater-crack-detection, version: 3)
and organises it under data/ for YOLOv8 training.

Usage:
    python download_dataset.py
"""

import os
from roboflow import Roboflow

# ── Configuration ──────────────────────────────────────────────────────────────
API_KEY        = os.environ.get("ROBOFLOW_API_KEY")
if not API_KEY:
    raise ValueError("Please set the ROBOFLOW_API_KEY environment variable.")
WORKSPACE      = "rov-crack-detection-3o91d"
PROJECT        = "underwater-crack-detection"
VERSION        = 3           # Version 3: 11,460 train / 368 val / 184 test
EXPORT_FORMAT  = "yolov8"    # Downloads train/valid/test splits in YOLO format
DOWNLOAD_DIR   = "data"      # Will be created under project root
# ──────────────────────────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("  HRT AI Inspection — Roboflow Dataset Downloader")
    print("=" * 60)
    print(f"  Workspace : {WORKSPACE}")
    print(f"  Project   : {PROJECT}")
    print(f"  Version   : {VERSION}")
    print(f"  Format    : {EXPORT_FORMAT}")
    print(f"  Target dir: {os.path.abspath(DOWNLOAD_DIR)}")
    print("=" * 60)

    rf      = Roboflow(api_key=API_KEY)
    project = rf.workspace(WORKSPACE).project(PROJECT)
    version = project.version(VERSION)

    dataset = version.download(EXPORT_FORMAT, location=DOWNLOAD_DIR, overwrite=False)

    print("\n✅ Download complete!")
    print(f"   Dataset location : {dataset.location}")
    print(f"   data.yaml        : {os.path.join(dataset.location, 'data.yaml')}")
    print("\nNext step → run:  python ai_pipeline/train.py")


if __name__ == "__main__":
    main()
