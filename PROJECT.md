# Project: HRT AI Inspection System Local Verification & Refinement

## Architecture
The system consists of four primary components:
1. **Frontend (`frontend/`)**: React 19 + Vite web application featuring Dashboard, Video Inspection Player, Geotechnical Spatial Analytics, PDF/CSV Reports, and a Three.js 3D Digital Twin (`TunnelTwin.jsx`) displaying the 250m cylindrical tunnel bore with defect markers projected at $R = 2.95\text{ m}$. Consumes REST API on port 3000 with fallback to `mockData.js`.
2. **Backend Core API (`backend/`)**: Express REST API on port 3000 providing `/api/detections` (ingestion & query filtering), `/api/spatial-summary` (chainage binning), `/api/inspections`, and `/api/reports/generate` (PDF/CSV via `pdfkit`). Interfaces with PostgreSQL (`pg.Pool`).
3. **MongoDB Ingestion Gateway (`api/`)**: Standalone Express microservice on port 5000 interfacing with MongoDB (`mongodb` driver) on `127.0.0.1:27017` for cloud telemetry spooling.
4. **AI Vision Pipeline (`ai_pipeline/`)**: YOLOv8-based crack detection and physical quantification engine (`predict.py`), using trained weights `runs/detect/hrt_crack_det/weights/best.pt`, optical quantification, and telemetry serialization.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Baseline Test Suite Execution | Run `npm test`, `node backend/src/api.test.js`, and `node backend/src/routes/spatial.test.js` | M1 | Survey (Backend/Integration) |
| 2 | MongoDB Local Service Connectivity | Configure `api/.env` to point to active local MongoDB service on `127.0.0.1:27017` | M2 | Survey (Backend) |
| 3 | PostgreSQL Service Audit | Inspect and document live PostgreSQL availability status per Requirement R2 | M2 | Survey (Backend) |
| 4 | Backend Environment Setup | Establish `backend/.env` based on `backend/.env.example` | M2 | Survey (Backend) |
| 5 | Frontend Environment Setup | Establish `frontend/.env` with `VITE_API_BASE_URL` and configure Vite dev proxy | M2 | Survey (Frontend) |
| 6 | Frame Indexing & Bound Fix | Fix 1-based frame indexing and detection frameIndex clamping in `InspectionVideos.jsx` | M3 | Survey (Frontend) |
| 7 | Frontend Lint Validation | Verify zero warnings/errors via `npx --prefix frontend oxlint` | M3 | Survey (Frontend) |
| 8 | Frontend Production Build | Verify exit code 0 via `npm --prefix frontend run build` | M3 | Survey (Frontend) |
| 9 | AI Inference CLI Hardening | Add `--no-api` support and sample fallback when camera 0 is unavailable in `predict.py` | M4 | Survey (AI Pipeline) |
| 10 | Model Weights Inference | Execute inference using `runs/detect/hrt_crack_det/weights/best.pt` on sample inspection video | M4 | Survey (AI Pipeline) |
| 11 | CPU Hardware Device Fallback | Ensure AI scripts dynamically resolve device to CPU when CUDA is unavailable | M4 | Survey (AI Pipeline) |
| 12 | Core API Service Startup | Start Backend Core API daemon on port 3000 and verify `/health` and endpoints | M5 | Survey (Backend) |
| 13 | MongoDB Gateway Startup | Start MongoDB Ingestion Gateway daemon on port 5000 and verify `/health` and live MongoDB connectivity | M5 | Survey (Backend) |
| 14 | Frontend Dev Server Startup | Start Frontend dev server on port 5173 and verify HTTP reachability | M5 | Survey (Frontend) |
| 15 | Browser Navigation & Page Rendering | Verify all dashboard, video inspection, analytics, and report views render without unhandled errors | M6 | Survey (Frontend) |
| 16 | 3D Digital Twin WebGL Rendering | Verify 3D digital twin loads, renders tunnel bore and defect markers without WebGL crashes | M6 | Survey (Frontend) |
| 17 | Defect Data Ingestion & Query Verification | Test JSON API payloads and data flow across backend and frontend | M6 | Survey (Backend/Frontend) |
| 18 | Git Attribution Verification | Verify all git commits are authored by Devansh Geria <devanshgeria510@gmail.com> | M7 | Survey (All) |
| 19 | Comprehensive Final Summary | Generate complete audit documentation of all tests, issues found, fixes applied, and system status | M7 | Requirement R6 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Baseline Test Suite Execution | Execute all existing test suites (`npm test`, `api.test.js`, `spatial.test.js`) and diagnose baseline results | none | DONE |
| M2 | Database & Environment Configuration | Configure MongoDB URI for local instance, configure `backend/.env` & `frontend/.env`, audit PostgreSQL status | M1 | DONE |
| M3 | Frontend Defect Remediation & Build | Fix `InspectionVideos.jsx` frame indexing & clamping, verify oxlint and production build | M2 | DONE |
| M4 | AI Pipeline Hardening & Inference | Fix `predict.py` CLI flags and fallbacks, verify model inference with `best.pt` | M2 | DONE |
| M5 | Multi-Service Startup & Live Verification | Boot Backend (3000), Gateway (5000), Frontend (5173), verify live DB connectivity and health checks | M2, M3, M4 | DONE |
| M6 | End-to-End Browser & 3D Twin Validation | Validate web UI, navigation, Three.js 3D twin, defect markers, and API data flows in browser | M5 | DONE |
| M7 | Final System Audit & Reporting | Full test re-run, git attribution check, comprehensive final summary and compliance report | M6 | DONE |

## Interface Contracts
### AI Pipeline (`predict.py`) ↔ Backend Core API (`backend/src/routes/detections.js`)
- **Protocol**: HTTP POST to `http://localhost:3000/api/detections`
- **Headers**: `Content-Type: application/json`
- **Payload Schema**:
  ```json
  {
    "class_label": "crack",
    "confidence": 0.85,
    "bbox": { "x1": 100, "y1": 50, "x2": 200, "y2": 150, "width": 100, "height": 100 },
    "frame_index": 1,
    "timestamp": "2026-11-09T19:00:00.000Z",
    "x": 1.25,
    "y": 2.67,
    "z": 10.5
  }
  ```
- **Responses**: `201 Created` (`{ success: true, detection_id, created_at }`), `400 Bad Request` (validation errors), `503 Service Unavailable` (DB offline).

### Frontend UI (`frontend/src/hooks/useApi.js`) ↔ Backend Core API (`backend/`)
- **Base URL**: `http://localhost:3000` (or `/api` via Vite dev proxy)
- **Endpoints**:
  - `GET /health`: `{ status: 'ok', service: 'HRT Inspection API' }`
  - `GET /api/detections`: `{ page, limit, total, total_pages, critical_count, data: [...] }`
  - `GET /api/spatial-summary`: `{ interval_m, tunnel_length_m: 250, total_detections, bins: [...] }`
  - `GET /api/inspections`: `{ page, limit, total, total_pages, data: [...] }`
  - `POST /api/reports/generate`: streaming PDF (`application/pdf`) or CSV (`text/csv`)
- **Fallback**: On network error or HTTP 500/503, frontend falls back to `frontend/src/data/mockData.js`.

### MongoDB Ingestion Gateway (`api/server.js`) ↔ Local MongoDB Server
- **Connection URI**: `mongodb://127.0.0.1:27017/hrt_inspection`
- **Endpoints**:
  - `GET /health`: 200 `"OK"`
  - `POST /api/detections`: 201 with `{ ...doc, _id }`
  - `GET /api/detections`: 200 array of latest 100 detections

## Code Layout
- `frontend/`: React 19 + Vite frontend application
  - `src/pages/twin/TunnelTwin.jsx`: Three.js 3D Digital Twin
  - `src/pages/dashboard/`: Dashboard pages & `InspectionVideos.jsx`
  - `src/hooks/useApi.js`: API client & data fetchers with fallback
  - `vite.config.js`: Bundler configuration and dev proxy
- `backend/`: Express REST API
  - `src/index.js`: Server entry point (port 3000)
  - `src/db/`: Database pool and DDL schema
  - `src/routes/`: REST API routes (detections, spatial, inspections, reports)
  - `src/api.test.js`: API contract test suite
  - `src/routes/spatial.test.js`: Geotechnical spatial test suite
- `api/`: MongoDB Ingestion Gateway
  - `server.js`: Server entry point (port 5000)
  - `.env`: MongoDB connection string and port
- `ai_pipeline/`: Computer vision & edge inference
  - `predict.py`: Real-time inference & physical crack quantification
  - `export_model.py`: Model serialization (ONNX, etc.)
  - `runs/detect/hrt_crack_det/weights/best.pt`: Trained crack detection model weights
- `scripts/`:
  - `verify_all.js`: Master 4-tier verification runner
  - `verify_browser_runtime.js`: Headless Chrome browser runtime verification runner
- `tests/`:
  - `tier1_feature.test.js`: Feature coverage suite
  - `tier2_boundary.test.js`: Boundary and corner case suite
  - `tier3_integration.test.js`: Database and multi-service integration suite
  - `tier4_workload.test.js`: Pipeline lifecycle and 3D digital twin geometry suite
