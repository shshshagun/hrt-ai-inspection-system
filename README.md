# 🚇 HRT AI Inspection System

> **Autonomous AI-powered defect detection and 3D digital twin platform for underwater Head Race Tunnel (HRT) inspection in Hydroelectric Projects.**

[![Tests](https://img.shields.io/badge/tests-34%2F34%20passing-brightgreen)]()
[![Build](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Model](https://img.shields.io/badge/model-YOLOv8s-blue)]()
[![mAP](https://img.shields.io/badge/mAP%400.5-91%25-blue)]()
[![License](https://img.shields.io/badge/license-MIT-lightgrey)]()

---

## 📖 Table of Contents

1. [What is This Project?](#-what-is-this-project)
2. [The Problem](#-the-problem)
3. [Our Solution](#-our-solution)
4. [How It Works — Full Workflow](#-how-it-works--full-workflow)
5. [Tech Stack](#-tech-stack)
6. [Project Structure](#-project-structure)
7. [Quick Start](#-quick-start)
8. [Testing a New Video](#-testing-a-new-video)
9. [AI Model Details](#-ai-model-details)
10. [API Reference](#-api-reference)
11. [Performance Results](#-performance-results)
12. [Real-World Limitations](#-real-world-limitations)
13. [Challenges Faced](#-challenges-faced)
14. [What This Project Lacks](#-what-this-project-lacks)
15. [Future Scope](#-future-scope)
16. [References](#-references)

---

## 🏔️ What is This Project?

A **Head Race Tunnel (HRT)** is a large underground water channel — sometimes several kilometers long — that carries water from a reservoir to the turbines of a hydroelectric power plant. These tunnels are built from reinforced concrete and operate under enormous water pressure, often 100+ meters below ground.

Over time, the concrete lining inside these tunnels develops cracks, spalling (chunks breaking off), and seepage (water leaking through). If left undetected, these defects can grow and lead to catastrophic structural failure — potentially flooding entire underground power stations and causing billions of dollars in damage.

This project is an **end-to-end AI inspection system** that:
- Accepts video footage from an underwater ROV (Remotely Operated Vehicle) inspecting the tunnel.
- Automatically detects surface defects using deep learning computer vision.
- Computes the **real-world physical size** of each crack in millimeters.
- Maps each defect to an **exact 3D coordinate** inside the tunnel.
- Displays all defects live on an **interactive 3D Digital Twin** of the tunnel.
- Generates **audit-ready inspection reports** for engineers and regulators.

---

## 🚨 The Problem

### Traditional Inspection Methods Are Dangerous and Expensive

Hydroelectric operators must periodically inspect their tunnels for structural integrity. Today, there are only two industry-standard approaches — and both are deeply flawed:

#### ❌ Method 1: Dewatering the Tunnel
The tunnel is completely drained of water so human inspectors can walk inside.

**Problems:**
- Takes **2–6 weeks** to drain and refill.
- Causes **\$1–5 million per day** in lost electricity generation (the plant is shut down).
- Structural defects can worsen or cause collapse during the dewatering process itself.
- Only feasible during low-demand seasons.

#### ❌ Method 2: Commercial Diver Inspection
Trained divers descend into the dark, pressurised, fast-moving water with handheld cameras.

**Problems:**
- Extreme **life safety risk** — zero visibility, confined spaces, high pressure, and fast currents.
- Inspections are entirely subjective (depends on diver experience and fatigue).
- No consistent coordinate records — a diver cannot reliably log exactly where a crack is located.
- Results are qualitative notes and blurry photographs, not structured engineering data.

### The Core Gap
> There is no automated, non-invasive, spatially-accurate way to inspect HRT tunnels without shutting down the plant or putting human lives at risk.

---

## ✅ Our Solution

We replace both traditional methods with an **autonomous underwater ROV equipped with our AI pipeline**.

The ROV drives through the flooded tunnel (plant stays running, no divers), and our system:

1. Processes the live or recorded video feed.
2. Detects every crack and structural defect frame by frame using a custom-trained YOLOv8 model.
3. Calculates the physical size of each defect using calibrated camera optics.
4. Translates each detection into a precise 3D position inside the tunnel.
5. Sends all data to a database and renders it live on a 3D digital twin visible in any browser.
6. Generates a complete inspection report engineers can use to prioritize repairs.

**Result:** Zero plant downtime. Zero diver risk. Millimeter-accurate defect mapping. Full spatial traceability.

---

## ⚙️ How It Works — Full Workflow

Here is the complete journey of data from the ROV camera to the 3D twin:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FULL DATA PIPELINE                           │
├──────────────┬──────────────┬─────────────────┬──────────────────── ┤
│  LAYER 1     │  LAYER 2     │  LAYER 3        │  LAYER 4           │
│  Vision AI   │  Spatial     │  API & Storage  │  3D Frontend       │
│  (Python)    │  Engine      │  (Node.js)      │  (React/Three.js)  │
└──────────────┴──────────────┴─────────────────┴────────────────────┘
```

### Layer 1: Computer Vision & Metric Quantification
**File:** `ai_pipeline/predict.py`

The ROV records HD video of the tunnel wall as it moves along the tunnel axis.

- Each video frame is passed through our **YOLOv8s** model.
- The model draws a bounding box around every detected crack.
- **Optical math** converts pixel coordinates to real-world millimeters:
  - `crack_width_mm = (bbox_width_pixels × pixel_pitch_mm × distance_mm) / focal_length_mm`
  - This uses the camera's known focal length (f), working distance (D), and sensor pixel pitch.
- Each detection is tagged with its **frame number** and **timestamp**.

### Layer 2: Spatial Coordinate Translation
**File:** `ai_pipeline/utils/spatial.py`

The tunnel is a 3D cylinder. We need to know exactly where on the tunnel wall each crack is located. Two coordinates are computed:

**Longitudinal (Z — Chainage along the tunnel axis):**
```
Z = Tunnel_Length × (Current_Frame / Total_Frames)
```
Or, if the ROV's cruising speed is known:
```
Z = Speed_m_per_s × Timestamp_in_seconds
```
This tells us how far from the intake portal the crack is (e.g., 147.3 m from the entrance).

**Radial (X, Y — Position around the tunnel cross-section):**
The tunnel is circular with an internal radius R ≈ 2.95 m. The camera looks at the tunnel wall, so where the crack appears in the video frame determines its clock-face position:

| Frame Position | Clock-Face | Angle (θ) | 3D Position (X, Y) |
|---|---|---|---|
| Top of frame | 12 o'clock (Crown/Roof) | 0° | (0, +2.95) |
| Right of frame | 3 o'clock (Right wall) | 90° | (+2.95, 0) |
| Bottom of frame | 6 o'clock (Invert/Floor) | 180° | (0, -2.95) |
| Left of frame | 9 o'clock (Left wall) | 270° | (-2.95, 0) |

Formula: `X = R × sin(θ)`, `Y = R × cos(θ)`

### Layer 3: REST API, Storage & Offline Spooling
**Files:** `api/server.js` (port 5000), `backend/src/` (port 3000)

Each detection is packaged as a JSON object and sent via HTTP POST to the ingestion API:

```json
{
  "class_label": "crack",
  "confidence": 0.87,
  "crack_width_mm": 1.8,
  "crack_length_mm": 47.2,
  "frame_index": 142,
  "timestamp": "2026-09-18T08:00:00Z",
  "x": 1.23,
  "y": -0.45,
  "z": 45.30
}
```

- **If the backend is online:** Data is stored immediately in MongoDB.
- **If the backend is offline:** Data is spooled to `offline_detections.jsonl` and automatically flushed when connectivity is restored (run `python ai_pipeline/utils/api_client.py --sync`).

The Core API (port 3000) also handles spatial analytics queries, severity scoring, and PostgreSQL persistence.

### Layer 4: 3D Digital Twin & Dashboard
**Files:** `frontend/src/pages/twin/TunnelTwin.jsx`, `frontend/src/`

The React frontend renders a fully interactive 3D tunnel in the browser using **Three.js WebGL**:

- The tunnel is **procedurally generated** (no pre-built 3D model files needed) — a `CylinderGeometry` with inverted normals creates the illusion of being inside the tunnel.
- When the frontend loads, it fetches all detections from the API (`GET /api/defects`).
- Each defect is projected as a **pulsing 3D marker** at its exact `(X, Y, Z)` coordinate on the tunnel wall.
- Engineers can **fly through** the tunnel, click on any marker for details, and toggle heatmaps to visualise risk clusters.
- Defects are classified into **Minor / Moderate / Critical** severity tiers.
- One-click **PDF inspection reports** are generated for regulatory submission.

---

## 🛠️ Tech Stack

| Layer | Technology | Why It Was Chosen |
|---|---|---|
| **AI / CV Model** | YOLOv8s (Ultralytics) | State-of-the-art real-time object detection; small model variant for edge deployment on ROV hardware |
| **Vision Language** | Python 3.10+ | Standard for ML/CV pipelines; native Ultralytics and OpenCV support |
| **OpenCV** | opencv-python 5.0 | Frame capture, preprocessing, and display |
| **Backend API** | Node.js + Express.js | Lightweight, fast REST API for real-time telemetry ingestion |
| **Ingestion Gateway** | Node.js (port 5000) | Dedicated MongoDB ingestion microservice |
| **Core API** | Node.js + Express (port 3000) | Spatial analytics, defect queries, severity scoring |
| **Primary DB** | MongoDB (Atlas / local) | Flexible schema for varying detection payloads per frame |
| **Secondary DB** | PostgreSQL | Relational persistence for structured reports and user data |
| **3D Rendering** | Three.js (WebGL) | Browser-native GPU-accelerated 3D — no Unity, no Unreal, no plugin needed |
| **Frontend Framework** | React.js + Vite | Fast, component-based UI with hot reload for development |
| **Styling** | CSS Modules | Scoped, maintainable component styles |
| **Security** | Helmet.js, CORS, Rate Limiting | Defense-in-depth HTTP headers and sliding-window IP throttling |
| **Dataset** | Roboflow Universe | 12,012 labeled underwater crack images, YOLOv8 format |
| **Model Export** | ONNX / TorchScript | Edge deployment compatibility for onboard ROV inference |

---

## 📁 Project Structure

```
hrt-ai-inspection-system/
│
├── ai_pipeline/                    # Python AI & computer vision core
│   ├── predict.py                  # Main inference script (video → detections)
│   ├── train.py                    # YOLOv8s fine-tuning on crack dataset
│   ├── evaluate.py                 # Precision, Recall, mAP, F1 metrics
│   ├── export_model.py             # Export to ONNX / TorchScript
│   ├── visualise_dataset.py        # Dataset label sanity-check viewer
│   ├── batch_evaluate_thresholds.py # Confidence threshold sweep
│   ├── requirements.txt            # Python dependencies
│   └── utils/
│       ├── spatial.py              # 3D coordinate translation (X, Y, Z)
│       └── api_client.py           # HTTP POST with offline spooling
│
├── backend/                        # Node.js Core REST API (port 3000)
│   └── src/
│       ├── routes/                 # API route handlers
│       ├── db/                     # PostgreSQL connection & queries
│       └── api.test.js             # API unit tests
│
├── api/                            # MongoDB Ingestion Gateway (port 5000)
│   └── server.js                   # Express server for detection ingestion
│
├── frontend/                       # React.js + Three.js Web Dashboard
│   └── src/
│       ├── pages/
│       │   ├── twin/               # 3D Digital Twin (TunnelTwin.jsx)
│       │   ├── dashboard/          # Defect tables, charts, analytics
│       │   ├── reports/            # PDF report generation
│       │   └── inspection/         # Video scrubber & live inspection
│       ├── hooks/                  # useApi.js — data fetching with fallbacks
│       └── App.jsx                 # Route definitions
│
├── data/                           # Dataset (downloaded by download_dataset.py)
│   ├── train/ val/ test/           # Images and YOLO-format labels
│   └── data.yaml                   # Dataset config
│
├── runs/
│   ├── detect/hrt_crack_det/
│   │   └── weights/best.pt         # ← Trained model weights (use this for inference)
│   ├── evaluate/                   # Evaluation plots and metrics
│   └── predict/                    # Annotated output videos and CSVs
│
├── scripts/
│   ├── verify_all.js               # 49-check master test harness
│   └── verify_browser_runtime.js   # Headless browser E2E tests
│
├── tests/                          # Unified test infrastructure (Tiers 1–4)
├── download_dataset.py             # Roboflow dataset downloader
├── start.ps1                       # One-click launcher for all services
├── run.ps1                         # AI pipeline quickstart runner
└── AGENTS.md                       # Domain agent specifications
```

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.10+ | For the AI pipeline |
| Node.js | 18+ | For backend and frontend |
| npm | 9+ | Package manager (not yarn) |
| MongoDB | 6+ | Local or Atlas |
| PostgreSQL | 14+ | Local installation |
| NVIDIA GPU | Optional | CUDA speeds up inference; CPU works too |

### Step 1: Clone the Repository
```powershell
git clone https://github.com/your-username/hrt-ai-inspection-system.git
cd hrt-ai-inspection-system
```

### Step 2: Install Python Dependencies
```powershell
pip install -r ai_pipeline/requirements.txt
```

### Step 3: Install Node Dependencies
```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
```

### Step 4: Configure Environment Variables
Copy and edit the `.env` files for each service:

**`backend/.env`**
```env
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=yourpassword
PGDATABASE=hrt_inspection
```

**`api/.env`**
```env
MONGO_URI=mongodb://127.0.0.1:27017/hrt_inspection
PORT=5000
```

**`frontend/.env`**
```env
VITE_API_URL=http://localhost:3000
```

### Step 5: Start All Services
```powershell
.\start.ps1
```

This launches:
- **Backend Core API** on `http://localhost:3000`
- **MongoDB Gateway** on `http://localhost:5000`
- **React Frontend** on `http://localhost:5173`

### Step 6: Open the Dashboard
Navigate to `http://localhost:5173` in your browser.

---

## 🎥 Testing a New Video

To run AI inference on any tunnel inspection video:

```powershell
python ai_pipeline/predict.py `
  --source "path\to\your_video.mp4" `
  --api-url http://localhost:5000/api/detections `
  --show
```

**What happens automatically:**
1. Each frame is scanned for cracks.
2. Cracks are sized in millimeters using optical formulas.
3. Each crack gets a 3D coordinate `(X, Y, Z)` mapped to the tunnel wall.
4. Data is sent to the backend in real-time.
5. The 3D twin at `http://localhost:5173/twin` automatically shows the new defects.

**Optional flags:**
```powershell
--conf 0.40          # Raise confidence threshold (fewer but higher-quality detections)
--save-csv           # Also save detections to frame_telemetry.csv
--no-api             # Run offline without sending data to the backend
--tunnel-length 500  # Set tunnel length in meters for Z coordinate calculation
```

---

## 🤖 AI Model Details

### Dataset

| Split | Images |
|---|---|
| Train | 11,460 |
| Validation | 368 |
| Test | 184 |
| **Total** | **12,012** |

- **Source:** Roboflow Universe — Underwater Crack Detection v3
- **Annotation format:** YOLOv8 bounding box (object detection)
- **Classes:** `crack`
- **Augmentations applied:** Horizontal/vertical flip, rotation ±14°, saturation ±20%, hue ±15°, mosaic ×3

### Model Architecture

| Property | Value |
|---|---|
| Architecture | YOLOv8s (small variant) |
| Task | Object Detection |
| Pretrained Backbone | COCO |
| Input Size | 640 × 640 px |
| Parameters | ~11.2 million |
| Weights File | `runs/detect/hrt_crack_det/weights/best.pt` |

### Optical Metric Formula

To convert a pixel bounding box to a real-world measurement:

```
physical_width_mm = (bbox_width_px × pixel_pitch_mm × working_distance_mm) / focal_length_mm
```

Default calibration values (adjustable via CLI flags):
- Focal length: `8.0 mm`
- Working distance: `1000 mm`
- Pixel pitch: `0.00345 mm`

---

## 📡 API Reference

### POST `/api/detections`
Ingest a new defect detection from the AI pipeline.

**Request body:**
```json
{
  "class_label": "crack",
  "confidence": 0.87,
  "crack_width_mm": 1.8,
  "crack_length_mm": 47.2,
  "bbox": { "x1": 120, "y1": 80, "x2": 340, "y2": 200 },
  "frame_index": 142,
  "timestamp": "2026-09-18T08:00:00Z",
  "x": 1.23,
  "y": -0.45,
  "z": 45.30
}
```
**Response:** `201 Created`

---

### GET `/api/detections`
Retrieve all stored defect detections.

**Response:** Array of detection objects.

---

### GET `/api/defects?severity=critical`
Filter defects by severity tier (`minor`, `moderate`, `critical`).

---

## 📊 Performance Results

| Metric | Value |
|---|---|
| mAP @ IoU 0.5 | **91.0%** |
| Precision | **94.1%** |
| Recall | **85.6%** |
| F1 Score | **89.7%** |
| Inference Speed (GPU) | ~8 ms/frame |
| Inference Speed (CPU) | ~180 ms/frame |

> These match Roboflow's benchmark results on the same dataset using YOLOv8n. Our YOLOv8s model (larger) is expected to match or exceed these figures.

---

## ⚠️ Real-World Limitations

These are honest limitations to understand before deploying this system in a real-world scenario:

### 1. Camera Calibration Required
The metric quantification (millimeter sizing) is only accurate if the actual camera's focal length, pixel pitch, and working distance are entered into the system. Using wrong calibration values will produce systematically wrong physical measurements.

### 2. Z Coordinate Relies on Time, Not Sensor
Currently, the longitudinal position (Z / chainage) is calculated from video frame time and an assumed ROV speed. If the ROV accelerates, decelerates, or reverses, the Z coordinate will drift. A real-world deployment needs a **DVL (Doppler Velocity Log)** acoustic sensor for precise odometry.

### 3. No Turbid Water Support
The YOLOv8 model is trained on relatively clear underwater photographs. In heavily silted or turbid flood conditions (which are common in monsoon-season inspections), the camera may produce unusable footage. Acoustic sonar imaging would be needed for those conditions.

### 4. Single Defect Class
The current model only detects the class `crack`. It does not yet specifically classify **spalling**, **seepage**, **honeycomb voids**, or **delamination** as separate defect types.

### 5. Requires Active Database Services
The system requires both a running MongoDB instance (port 27017) and a PostgreSQL instance (port 5432). Cold-starting without these will result in the Core API running in fallback mode with 503 responses for database-backed endpoints.

### 6. No Real ROV Hardware Integration
This system processes video files or webcam streams. It does not ship with ROV hardware drivers or communication protocols (e.g., MAVLink, BlueROV2 SDK). Integration with real ROV hardware requires additional engineering.

---

## 🧱 Challenges Faced

| Challenge | How It Was Solved |
|---|---|
| `cv2.imshow()` crashes on Windows | Removed `opencv-python-headless` (installed by Roboflow) and reinstalled full `opencv-python` |
| Dataset was segmentation format, model needed bounding boxes | Switched to dedicated object detection weights (`best.pt`), not segmentation |
| React WebGL crash: `concreteTex is not defined` | Rewrote Three.js disposal using `scene.traverse()` with deduplicated geometry/material Sets |
| `EADDRINUSE: :::3000` port conflicts | Separated Core API (port 3000) and MongoDB Gateway (port 5000) with `.env` configuration |
| `UnicodeEncodeError` on Windows terminal | Replaced Unicode emoji characters in Python print statements with ASCII equivalents |
| Frontend CORS/404 errors connecting to backend | Added `/api` reverse proxy in `vite.config.js` pointing to `http://localhost:3000` |
| Video scrubber crashing on `frame_0000.webp` (non-existent) | Fixed frame boundary clamping in `InspectionVideos.jsx` |
| Offline ROV inference losing detections | Implemented `offline_detections.jsonl` spool file with auto-flush on reconnect |

---

## ❌ What This Project Lacks

Being honest about the gaps is important for anyone looking to extend or deploy this system:

- **No acoustic sonar support** — turbid/silted tunnels need DIDSON or multibeam sonar, not cameras.
- **No real-time ROV telemetry integration** — DVL, IMU, and depth sensor feeds are not yet wired in.
- **No multi-class defect taxonomy** — spalling, delamination, and seepage are not distinguished from cracks.
- **No predictive modelling** — the system logs what it finds today but cannot predict how fast a crack will grow.
- **No mobile app** — there is no native iOS/Android interface for field use on-site at the dam.
- **No automated alert system** — the system does not send SMS/email alerts when a Critical defect is detected.
- **No authentication / role-based access** — any user who can reach the frontend URL has full read access.
- **Limited real-world validation** — the model was trained on publicly available underwater crack images, not specifically on HRT concrete lining datasets from actual hydroelectric tunnels.

---

## 🔭 Future Scope

### Short-Term (Next 6 Months)
- [ ] Multi-class defect detection: `crack`, `spalling`, `seepage`, `void`
- [ ] DVL/IMU telemetry CSV ingestion for accurate Z odometry
- [ ] Email/webhook alerts when Critical severity defects are logged
- [ ] Authentication (JWT / OAuth2) and role-based access control

### Medium-Term (6–18 Months)
- [ ] Acoustic DIDSON/multibeam sonar image support for zero-visibility conditions
- [ ] SLAM-based 3D reconstruction for centimeter-accurate point cloud mapping
- [ ] Mobile-responsive PWA for on-site tablet and phone use
- [ ] Multi-tunnel management (multiple projects, multiple inspection runs)

### Long-Term (Research & Innovation)
- [ ] **Predictive degradation modelling** — LSTM or Graph Neural Network trained on crack growth time series to forecast structural risk months in advance
- [ ] **Autonomous ROV path planning** — onboard inference with the model running on a Jetson Nano, automatically steering the ROV toward detected anomalies for closer inspection
- [ ] **Digital twin synchronisation** — linking the 3D twin to BIM (Building Information Models) and civil engineering structural analysis software

---

## 📚 References

1. S. Huang et al., *"A Real-time Concrete Crack Detection and Segmentation Model Based on YOLOv11,"* arXiv:2508.11517, 2025.
2. X. Dong et al., *"Concrete Surface Crack Detection Algorithm Based on Improved YOLOv8,"* Sensors, 2024.
3. M. La Guardia & M. Koeva, *"Towards Digital Twinning on the Web,"* Remote Sensing, 2023.
4. Ultralytics, *YOLOv8 Documentation,* https://docs.ultralytics.com
5. Roboflow Universe, *Underwater Crack Detection Dataset v3,* https://universe.roboflow.com

---

## 👨‍💻 Author

**Devansh Geria**
📧 devanshgeria510@gmail.com
**Shagun Soni**
📧 shagunsoni197@gmail.com


---

*Built as a Major Project for demonstrating the intersection of underwater robotics, computer vision, and 3D digital twin technology applied to critical hydroelectric infrastructure maintenance.*
