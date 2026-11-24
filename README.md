# 🚇 HRT AI Inspection System

> **Autonomous AI-powered defect detection and 3D digital twin platform for underwater Head Race Tunnel (HRT) inspection in Hydroelectric Projects.**

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)]()
[![Build](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Model](https://img.shields.io/badge/model-YOLOv8n--seg%20(ONNX)-blue)]()
[![mAP](https://img.shields.io/badge/mAP%400.5%20(test%20split)-0.58-blue)]()
[![Live](https://img.shields.io/badge/live-Vercel-black)](https://hrt-ai-inspection-system.vercel.app/)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)]()

---

## 📖 Table of Contents

1. [What is This Project?](#-what-is-this-project)
2. [The Problem](#-the-problem)
3. [Our Solution](#-our-solution)
4. [How It Works — Full Workflow](#-how-it-works--full-workflow)
5. [Feature Overview](#-feature-overview)
6. [Tech Stack](#-tech-stack)
7. [Project Structure](#-project-structure)
8. [Quick Start](#-quick-start)
9. [Testing](#-testing)
10. [Live Deployment and Demo Mode](#-live-deployment)
11. [Authentication and Roles](#-authentication-and-roles)
12. [Ask HRT — AI Assistant](#-ask-hrt--ai-assistant)
13. [Privacy and Compliance](#-privacy-and-compliance)
14. [Testing a New Video](#-testing-a-new-video)
15. [AI Model Details](#-ai-model-details)
16. [API Reference](#-api-reference)
17. [Performance Results](#-performance-results)
18. [Real-World Limitations](#-real-world-limitations)
19. [Challenges Faced](#-challenges-faced)
20. [What This Project Lacks](#-what-this-project-lacks)
21. [Future Scope](#-future-scope)
22. [References](#-references)

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
2. Detects cracks frame by frame with a YOLOv8n-seg crack-segmentation model (see [AI Model Details](#-ai-model-details) for its provenance), then checks each detection with shape rules, a small crack / not-crack classifier and engineer review, so only real cracks are counted.
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

- Each video frame is passed through the **YOLOv8n-seg** crack model (in the browser through ONNX Runtime Web, or from Python with `predict.py`).
- The model returns a box and a mask for every detected crack; the browser pipeline scans five overlapping 640 × 640 tiles per frame, merges overlaps and tracks each crack across frames so it is counted once.
- **Optical math** converts pixel coordinates to real-world millimeters:
  - `crack_width_mm = (bbox_width_pixels × pixel_pitch_mm × distance_mm) / focal_length_mm`
  - This uses the camera's known focal length (f), working distance (D), and sensor pixel pitch.
- Each detection is tagged with its **frame number** and **timestamp**, and is stored with an automatic crack / candidate verdict and a review status (see [Only Real Cracks Are Counted](#only-real-cracks-are-counted)).

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
**Files:** `api/server.js` (port 5000, the production gateway), `backend/src/` (port 3000, core analytics API)

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
**Files:** `frontend/src/pages/twin/` (`TunnelTwin.jsx`, `engine.js`, `geometry.js`, `textures.js`), `frontend/src/`

The React frontend renders a fully interactive 3D tunnel in the browser using **Three.js WebGL**:

- The tunnel is **procedurally generated** (no pre-built 3D model files needed). The page is split into engine, geometry and texture modules; geometry and data rules are covered by Node tests.
- The frontend fetches the stored detections (`GET /api/detections`, up to 1,000 by default) and projects each one as a marker at its `(X, Y, Z)` position on the tunnel wall. Detections with no recorded chainage are not drawn, and the dashboard says how many are left out.
- Cameras: fly-through and orbit. Defects are classified **Minor / Moderate / Critical**.
- Inspection viewer tools: severity glow on the lining, a cross-section cut, a measure tool, a defect replay with captions, an inspection filter with a time-lapse, a clock-face minimap, wall snapshots of the selected defect, a view-only horseshoe section with CSV radius profile, screenshot and share link, and an experimental VR button.
- PDF inspection reports are generated for regulatory submission (see [Feature Overview](#-feature-overview)).

---

## ✨ Feature Overview

| Area | What it does |
|---|---|
| **Landing page and console** | Survey-console landing page (jet black and sky blue), descent intro and dive transition between pages, light and dark theme, a 404 page, per-page tab titles |
| **Dashboard** | Tunnel radar, chainage strip, auto-written brief, counting KPIs, severity charts; `Ctrl+K` command palette, toasts, loading skeletons and a notice while the free-tier server wakes up |
| **Inspection console** | Video, webcam and photo modes; sonar sweep, defect ping, chainage tape and keyboard shortcuts in the viewport; a repeat-inspection helper |
| **Defect detail** | Before/after slider and growth table for a defect seen in several inspections; *Flag for Urgent Repair* and *Add Observation*; a snapshot and history link in the twin inspector |
| **3D twin** | See Layer 4 above |
| **Reports** | *Summary + PDF* dialog: a summary is drafted from the database (AI prose when a key is set, otherwise a standard template), the engineer edits it, and the PDF gains the summary, an unrolled-lining defect map and a severity bar chart. Every number in an AI draft is checked against the facts. CSV export is also available |
| **Ask HRT** | Chat and natural-language search over the defect data (see [Ask HRT](#-ask-hrt--ai-assistant)) |
| **Accounts** | Sign-up, sign-in, role-based access, forgot-password by e-mailed code (see [Authentication](#-authentication-and-roles)) |
| **Demo mode** | Read-only demo with bundled sample data, no account needed |

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
| **Browser inference** | ONNX Runtime Web (WebAssembly) | Runs the exported model client-side, so no server GPU is needed |
| **Security** | Helmet.js, CORS, Rate Limiting, bcrypt, JWT | Defense-in-depth HTTP headers, throttling, hashed passwords and signed sessions |
| **AI assistant** | Google Gemini (free tier), Groq (free tier, backup) | Ask HRT chat, search and report drafting, with automatic failover between providers |
| **E-mail** | nodemailer (any SMTP service) | One-time codes for password reset |
| **Reports** | pdfkit | PDF inspection reports with defect map and severity chart |
| **Hosting** | Vercel (front end), Render (gateway), MongoDB Atlas | Free-tier deployment |
| **Dataset (evaluation)** | Roboflow Universe | 12,012 labeled underwater crack images, YOLOv8 format |
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
├── api/                            # MongoDB Gateway (port 5000), the production API
│   ├── server.js                   # Detections, inspections, reports, PDF export
│   ├── auth/                       # Login, sign-up, roles, password reset, mailer
│   └── assistant/                  # Ask HRT: Gemini and Groq providers, tools, report drafting
│
├── frontend/                       # React.js + Three.js Web Dashboard
│   └── src/
│       ├── pages/
│       │   ├── twin/               # 3D twin: TunnelTwin.jsx, engine.js, geometry.js, textures.js
│       │   ├── dashboard/          # Overview, defect detail, inspections, reports, users
│       │   └── inspection/         # New inspection console (video, webcam, photos)
│       ├── auth/                   # Login, sign-up, forgot password
│       ├── ui/                     # Command palette, toasts, theme, dive transition
│       ├── utils/                  # defectHistory, keywordSearch, reportDraft
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
│   ├── verify_all.js               # Master test harness (four tiers)
│   └── verify_browser_runtime.js   # Headless browser E2E tests
│
├── tests/                          # Unit and tier tests (Tiers 1–4)
├── download_dataset.py             # Roboflow dataset downloader
├── start.ps1                       # One-click launcher for all services
└── run.ps1                         # AI pipeline quickstart runner
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
git clone https://github.com/shshshagun/hrt-ai-inspection-system.git
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

**`api/.env`** (copy `api/.env.example`, which documents every variable)
```env
MONGODB_URI=mongodb://127.0.0.1:27017/hrt_inspection
PORT=5000
JWT_SECRET=at-least-16-random-characters
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=a-long-password
```
The optional assistant and e-mail settings are listed under [Ask HRT](#-ask-hrt--ai-assistant) and [Authentication](#-authentication-and-roles).

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

## ✅ Testing

```powershell
npm test                              # API contract, spatial analytics, authentication, sign-up, password reset, assistant, defect tracker and history, keyword search, twin geometry, report draft
node scripts/verify_all.js            # all four test tiers (Tier 3 needs a local MongoDB, Tier 1 needs the Python packages)
npx --prefix frontend oxlint frontend/src
npm --prefix frontend run build
```

| Tier | Covers |
|---|---|
| 1 | Baseline: unit suites, lint, production build, Python inference |
| 2 | Boundary and corner cases of the API and spatial maths |
| 3 | Cross-component: gateway against a real MongoDB with login, core API health |
| 4 | Workload and 3D geometry (every marker lies at radius 2.95 m on the tunnel surface) |

GitHub Actions (`.github/workflows/ci.yml`) runs the unit tests, the Tier 2 and Tier 4 checks, lint and the build on every push and pull request.

## 🌐 Live Deployment

- **Front end:** https://hrt-ai-inspection-system.vercel.app/ (Vercel; `frontend/vercel.json` rewrites every path to the single-page app, so dashboard links and refreshes work)
- **Gateway API:** https://hrt-mongo-gateway.onrender.com (Render; the free tier can take about 30 s to wake up, and the app shows a notice while it does)
- **Demo mode:** a visitor can open the dashboard, 3D twin and reports without an account. API calls are answered in the browser from bundled sample data (3 inspections, 15 defects) and every write is refused.

## 🔐 Authentication and Roles

The gateway (`api/`) requires a login. Passwords are stored as bcrypt hashes and sessions are signed JWTs (8 h by default).

**Accounts.** Anyone can sign up at `/register` (sign in at `/login`, reset a forgotten password from the sign-in page); a new account is a read-only **Viewer**. An Administrator raises the role on the Users page. **Administrator accounts can only be added in the server configuration (Render environment variables)**: the API and the sign-up form can never create or grant one.

| Role | Can do |
|---|---|
| Viewer | View detections and inspections (the role given at sign-up) |
| Operator | View; start inspections and upload video, webcam or photos |
| Engineer | View; review detections |
| Manager | View; generate PDF/CSV reports |
| Administrator | Everything, including deleting detections and sessions and managing users |

**Server configuration** (see `api/.env.example`; on Render: service → Environment):

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signing secret, at least 16 random characters. Without it every protected endpoint answers 503 (fails closed). |
| `ADMIN_ACCOUNTS` | JSON array of Administrators, e.g. `[{"email":"a@x.com","password":"...","name":"A"}]`. On every start each account is created, or repaired and set to the configured password. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | A single Administrator (can be used instead of, or with, `ADMIN_ACCOUNTS`). |
| `ALLOW_REGISTRATION` | `false` closes public sign-up (default `true`). Sign-up is limited to 5 per hour per client. |
| `ALLOWED_ORIGINS` | Browser origins allowed in production, e.g. `https://hrt-ai-inspection-system.vercel.app`. |
| `AUTH_ENABLED=false` | Local development only: skips all checks. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Any SMTP service (for Gmail use an app password). Without them forgot-password is off and the sign-in link leads to a clear message. `MAIL_TRANSPORT=console` prints the e-mail locally instead of sending it (ignored in production). |

**Forgot password.** `POST /api/auth/forgot-password` e-mails a 6-digit one-time code; `POST /api/auth/reset-password` checks it and sets the new password. The code is stored only as an HMAC hash, works once, expires after 10 minutes and locks after 5 wrong tries; requests are limited to one a minute and five an hour per address. The answer never reveals whether an address has an account. Disabled accounts and Administrators (whose passwords come from the server configuration) are refused silently. A reset, or an Administrator password change, ends sessions issued before it.

The front end follows the same rules (hidden menu entries, access-denied pages), but the server is the authority: it answers 401 without a valid token and 403 when the role lacks the permission. Run `node api/auth/devServer.js` to try the flow locally with demo accounts and no database. Set `VITE_AUTH_ENABLED=false` in `frontend/.env` to run the front end against the core API on port 3000 without a login.

## 🤖 Ask HRT — AI Assistant

Ask HRT answers questions about the stored inspection data, runs natural-language defect searches and drafts the report summary. It only receives defect data (no names, e-mails, images or notes) and uses **free-tier models only**.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Free key from Google AI Studio. The assistant stays switched off while no provider key is set. |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | Free-tier model names (default `gemini-3.5-flash-lite`); non-free names are ignored unless `GEMINI_ALLOW_PAID=true` |
| `GROQ_API_KEY`, `GROQ_MODEL` | Backup provider on Groq's free plan (default `openai/gpt-oss-20b`) |
| `ASSISTANT_PROVIDERS` | Order providers are tried in (default `gemini,groq`); the next one answers when the first is at its limit, down or misconfigured |
| `ASSISTANT_RPM_USER`, `ASSISTANT_RPM_GLOBAL` | Questions allowed per minute (defaults 8 and 12) |

Endpoints: `GET /api/assistant/status` (lists the active providers), `POST /api/assistant/chat`, `POST /api/assistant/search` and `POST /api/assistant/report-draft`. Keys live only in the host's environment settings, never in the repository.

---

## 🔏 Privacy and Compliance

The app sets **no cookies** and has no analytics. It ships a [Privacy Policy](frontend/src/pages/legal/PrivacyPolicy.jsx) (`/privacy`), [Terms of Use](frontend/src/pages/legal/Terms.jsx) (`/terms`) and a cookie/storage page with a consent choice (`/cookies`); fonts are self-hosted so visitors' browsers do not contact Google. Edit the operator and contact details in `frontend/src/config/legal.js`. The privacy-law map, known gaps, licence notes (including the Ultralytics AGPL question) and the IEEE standards that apply are in [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md). This is an engineering record, not legal advice.

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

### Model Architecture and Provenance

| Property | Value |
|---|---|
| Deployed model | `frontend/public/models/hrt_yolov8_crack.onnx` (12.6 MB), run in the browser with ONNX Runtime Web |
| Architecture | YOLOv8n-seg (nano, instance segmentation), 1 class: `crack` |
| Input size | 640 × 640 px |
| Origin | An existing crack-segmentation model. The file embeds Ultralytics metadata stating it was trained on the Ultralytics `crack-seg` dataset, and `best.pt` is byte-identical to `best_opensistemas.pt`. **We did not train this network.** |
| Our contribution | The browser inference pipeline (tiled scan, mask decoding, box consolidation, multi-frame tracker), spatial mapping, services, 3D twin and the evaluation below |
| Training code | `ai_pipeline/train.py` trains YOLOv8s on the Roboflow dataset; the log of that run is `runs/detect/hrt_crack_det/results.csv` (best validation mAP@0.5 0.68, epoch 103). Those weights are not kept in the repository. |

### Only Real Cracks Are Counted

The detector has one class and fires on stains, ring joints and shadows as well as cracks. Every detection therefore goes through three checks before it counts, and the dashboard, 3D twin, reports, PDF and Ask HRT all use the same rule.

1. **Automatic verdict (in the browser, `frontend/src/utils/crackVerdict.js`).** A detection is a `crack` only if its mask is long and thin (elongation of at least 2.5, at least 30 mask pixels, box aspect of at least 2.2), the confidence is at least 0.5, it was seen in at least 3 frames (not applied to single photos) and it is not the texture-based "spalling" estimate. Anything else is stored as a `candidate` with the reasons (`low_confidence`, `blob_shape`, `too_small`, `compact_box`, `few_frames`, `texture_heuristic`).
2. **Second-stage classifier (`frontend/public/models/hrt_crack_cls.onnx`, 6 MB).** A MobileNetV3-small looks at a 224 × 224 crop of each detection and answers crack / not a crack. A score below 0.3 makes the detection a candidate, a score between 0.3 and 0.7 is "unsure" (also a candidate), and 0.7 or more lets it stay a crack. If the file is missing nothing changes; if it is present but fails to run, detections become candidates rather than being trusted blindly.
3. **Engineer review.** Every stored detection starts as `pending`. An Engineer or Administrator confirms it or rejects it (with a reason: shadow, stain, ring joint, debris, texture, other); the Detections page has tabs for Cracks, Awaiting review, Rejected and All, and bulk confirm / reject. A detection **counts as a crack** when it is confirmed, or when it is unreviewed and the automatic verdict is `crack`. A rejected detection never counts. Records stored before this feature have no verdict and show as awaiting review.

The scope picker in the top bar switches the whole app between *Cracks only*, *Cracks + awaiting review* and *Everything*. The API takes the same choice as `?view=counted|not_rejected|pending|rejected|all`. A test (`tests/detectionRules.test.js`) checks that the browser rule, the server function and the MongoDB query agree on every combination.

**Classifier accuracy.** Trained on the public Özgenel and Sorguc concrete-crack dataset (Mendeley Data, CC BY 4.0) plus crack and crack-free crops cut from the Roboflow underwater set, and tested on held-out blocks of both (1,862 crops): precision 0.996, recall 0.996, F1 0.996 at 0.5. **This is not the accuracy of the whole system.** Those datasets are easy (close-up, well lit) and neighbouring patches of one wall can appear in both train and test. The honest number needs footage from the tunnel, sorted by hand: `ai_pipeline/extract_frames.py` pulls frames out of a video and `ai_pipeline/evaluate_own_frames.py` scores them (recall on frames with a crack, false-alarm rate on frames without).

**Retrained detector (not deployed).** `ai_pipeline/train_v2.py` fine-tunes YOLOv8n on the Roboflow data plus 1,300 crack-free negatives (`build_negative_set.py`), and `ai_pipeline/compare_detectors.py` scores it against the deployed model on the same images. On the 184-image crack test split at confidence 0.5, the retrained model reached precision 0.956 and recall 0.709 (mAP@0.5 0.831), against 0.830, 0.519 and 0.578 for the deployed model. It draws boxes only (no masks), so the mask-shape rule would have to be adapted before it replaces the segmentation model, and it has not been tested on tunnel footage. It is kept as a candidate.

**Why it is not self-correcting yet.** Reviews are stored, but nothing retrains the models from them. Closing that loop (export confirmed and rejected crops, retrain, accept a new model only if it beats the current one on a frozen test set) is future work.

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

All gateway routes (port 5000) except `/health`, `/api/auth/login`, `/api/auth/register`, `/api/auth/config` and the password-reset routes require a session token (`Authorization: Bearer <jwt>`). The server answers `401` without a valid token and `403` when the role lacks the permission.

| Method and path | Permission | Purpose |
|---|---|---|
| `POST /api/detections` | create | Ingest a detection from the AI pipeline |
| `GET /api/detections` | read | List detections (default 1,000, at most 2,000; `?limit=`, `?severity=`, `?inspection_id=`, `?view=counted\|not_rejected\|pending\|rejected\|all`) |
| `GET /api/detections/:id` | read | One detection |
| `PATCH /api/detections/:id` | review | Confirm or reject (`review_status`, `reject_reason`), flag or annotate a detection |
| `POST /api/detections/bulk-review` | review | Confirm or reject up to 200 detections at once |
| `DELETE /api/detections/:id` | delete | Remove a detection |
| `GET /api/inspections` | read | Inspection sessions |
| `DELETE /api/inspections/:id` | delete | Remove a session |
| `GET /api/spatial-summary` | read | Counts per chainage bin |
| `POST /api/reports/generate` | reports | Build a report |
| `GET /api/inspections/:id/export/pdf` | reports | PDF with summary, defect map and severity chart |
| `POST /api/auth/login`, `/register`, `/forgot-password`, `/reset-password` | public | Sign-in, sign-up and password reset |
| `GET /api/auth/me`, `/api/roles` | signed in | Current user and roles |
| `GET/POST/PATCH /api/users` | user management | Administrator user management |
| `GET /api/assistant/status`, `POST /api/assistant/chat`, `/search`, `/report-draft` | signed in (report-draft: reports) | Ask HRT |
| `GET /health` | public | Service health |

**Example: `POST /api/detections`**
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
Response: `201 Created`.

The core API (port 3000) serves the spatial analytics routes in `backend/src/routes/`.

---

## 📊 Performance Results

Measured on the **184-image test split** of the Roboflow Underwater Crack Detection v3 dataset (368 labelled cracks) with the model that is actually deployed (`python ai_pipeline/evaluate_onnx.py`). Box-based scoring, one full 640 × 640 frame per image, NMS IoU 0.45.

| Metric | Value |
|---|---|
| mAP @ IoU 0.5 | **0.578** |
| mAP @ IoU 0.5:0.95 | **0.378** |
| Precision at the app threshold (conf 0.42) | **0.827** |
| Recall at conf 0.42 | **0.533** |
| F1 at conf 0.42 | **0.648** (best F1 0.655 at conf 0.30) |
| Latency (ONNX Runtime, laptop CPU, AMD Ryzen) | **46 ms per image** (median; p95 52 ms) |

> The deployed model was trained on a different crack dataset, so these figures describe how well it transfers to underwater imagery: it is precise but misses about half of the cracks at the default threshold. The 91 % mAP quoted in earlier versions of this README was Roboflow's published figure for its own YOLOv8n model on this dataset, not a measurement of this system. Browser inference (WebAssembly, tiled scan) is slower than the CPU figure above and was not benchmarked separately.

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
- **No automated alert system** — e-mail is used only for password-reset codes; nothing is sent when a Critical defect is detected.
- **No multi-factor login or single sign-on** — sign-up, role-based access and forgot-password by e-mailed code exist (see [Authentication](#-authentication-and-roles)), but not MFA or SSO.
- **Crack filtering is not yet measured on tunnel footage** — the shape rules and classifier are tested on public datasets only, and the models do not retrain themselves from engineer reviews.
- **Limited real-world validation** — the deployed model was trained on a public crack-segmentation dataset and tested only on public underwater crack images, not on footage from actual hydroelectric tunnels. The team does not operate an ROV and did not record any video.

---

## 🔭 Future Scope

### Short-Term (Next 6 Months)
- [ ] Multi-class defect detection: `crack`, `spalling`, `seepage`, `void`
- [ ] DVL/IMU telemetry CSV ingestion for accurate Z odometry
- [ ] Email/webhook alerts when Critical severity defects are logged
- [x] Authentication (JWT) with role-based access control, sign-up and forgot-password *(done)*
- [ ] Multi-factor login or single sign-on

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
