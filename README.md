# HRT AI Inspection System

**AI-powered defect detection and inspection system for ROV-based Head Race Tunnel (HRT) inspection in Hydroelectric Projects**

---

## 🏗️ System Architecture

```
ROV Video Feed
     │
     ▼
┌─────────────────────────────────┐
│   AI Pipeline (YOLOv8s)         │  ← You are here
│   detect cracks from video      │
└────────────┬────────────────────┘
             │ HTTP POST /api/detections
             ▼
┌─────────────────────────────────┐
│   REST API (Node.js/Express)    │
│   receives & stores detections  │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│   PostgreSQL Database           │
│   spatial defect records        │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│   React.js + Three.js Dashboard │
│   3D digital twin + table view  │
└─────────────────────────────────┘
```

---

## 🤖 AI Pipeline (Component 1)

### Dataset
| Split | Images |
|-------|--------|
| Train | 11,460 |
| Val   | 368    |
| Test  | 184    |
| **Total** | **12,012** |

- **Source**: Roboflow — Underwater Crack Detection v3
- **Format**: YOLOv8 bounding-box (object detection)
- **Classes**: `crack`
- **Augmentations**: flip H/V, rotate ±14°, saturation ±20%, hue ±15°, mosaic ×3

### Model
| Property | Value |
|----------|-------|
| Architecture | YOLOv8s (small) |
| Task | Object Detection |
| Pretrained | COCO |
| Input Size | 640 × 640 |
| Parameters | ~11.2M |

---

## 🚀 Quickstart

### Prerequisites
- Python 3.10+
- NVIDIA GPU with CUDA (recommended)
- Git

### 1. Install dependencies
```powershell
python -m pip install -r ai_pipeline/requirements.txt
```

### 2. Download dataset
```powershell
python download_dataset.py
```

### 3. Train
```powershell
python ai_pipeline/train.py
# Weights saved to: runs/detect/hrt_crack_det/weights/best.pt
```

### 4. Evaluate
```powershell
python ai_pipeline/evaluate.py --split test
```

### 5. Run inference on a video
```powershell
python ai_pipeline/predict.py --source path/to/rov_video.mp4
# Output annotated video: runs/predictions/annotated_<timestamp>.mp4
# CSV log:               runs/predictions/detections_<timestamp>.csv
```

### 6. Optional — Export to ONNX
```powershell
python ai_pipeline/export_model.py --format onnx
```

### Or use the quickstart script
```powershell
# Full pipeline (install → download → train → evaluate)
.\run.ps1 -Step all

# Inference only
.\run.ps1 -Step predict -Source path/to/video.mp4 -NoApi
```

---

## 📁 Project Structure

```
hrt-ai-inspection-system/
├── ai_pipeline/
│   ├── train.py                    # YOLOv8s training
│   ├── predict.py                  # Inference + API posting
│   ├── evaluate.py                 # Metrics: P, R, mAP, F1
│   ├── export_model.py             # ONNX / TorchScript export
│   ├── visualise_dataset.py        # Visual label sanity-check
│   ├── batch_evaluate_thresholds.py # Conf threshold sweep
│   ├── requirements.txt
│   └── utils/
│       ├── spatial.py              # Simulated ROV telemetry (X, Y, Z)
│       └── api_client.py           # HTTP POST to REST API
├── data/                           # ← Downloaded by download_dataset.py
│   ├── train/images/ & labels/
│   ├── valid/images/ & labels/
│   ├── test/images/ & labels/
│   └── data.yaml
├── runs/
│   ├── detect/hrt_crack_det/       # Training outputs (weights, plots)
│   ├── evaluate/                   # Evaluation reports + plots
│   └── predictions/                # Annotated video + CSV logs
├── download_dataset.py             # Roboflow dataset downloader
├── run.ps1                         # PowerShell quickstart runner
├── Major Project Synopsis.docx
└── README.md
```

---

## 📊 Expected Performance

Based on the Roboflow-hosted model trained on this dataset (same data, YOLOv8n):

| Metric | Value |
|--------|-------|
| mAP @ 0.5 | **91.0%** |
| Precision | **94.1%** |
| Recall | **85.6%** |

Our YOLOv8s fine-tuned model is expected to **match or exceed** these numbers.

---

## 🔌 Detection JSON Schema (API payload)

```json
{
  "class_label": "crack",
  "confidence": 0.87,
  "bbox": {
    "x1": 120.5, "y1": 80.2, "x2": 340.1, "y2": 200.8,
    "width": 219.6, "height": 120.6
  },
  "frame_index": 142,
  "timestamp": "2026-09-18T08:00:00Z",
  "x": 1.23,
  "y": -0.45,
  "z": 45.30
}
```

---

## 📚 References

1. S. Huang et al., "A Real-time Concrete Crack Detection and Segmentation Model Based on YOLOv11," arXiv:2508.11517, 2025.
2. X. Dong et al., "Concrete Surface Crack Detection Algorithm Based on Improved YOLOv8," Sensors, 2024.
3. M. La Guardia & M. Koeva, "Towards Digital Twinning on the Web," Remote Sens., 2023.
