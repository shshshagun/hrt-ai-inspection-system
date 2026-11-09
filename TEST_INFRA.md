# Test Infrastructure & Quality Assurance Specification
# HRT AI Inspection System

## 1. Test Philosophy & Core Principles

The testing strategy for the Headrace Tunnel (HRT) AI Inspection System enforces rigorous, automated verification across the complete software and hardware-in-the-loop simulation stack. It is grounded in four foundational pillars:

### 1.1 Opaque-Box Behavioral Testing
Tests interact with software boundaries exclusively through public API contracts, CLI interfaces, HTTP endpoints, and deterministic database queries. Implementation internals (private helper functions, state closures) are treated as opaque, ensuring that tests validate actual business behavior rather than implementation details.

### 1.2 Requirement-Driven Verification (R1 – R6)
Every test case in the test matrix traces directly to system requirements defined in `ORIGINAL_REQUEST.md`:
- **R1 (Test Suite Execution & Validation)**: Automatic execution of baseline suites (`api.test.js`, `spatial.test.js`, AI pipeline).
- **R2 (Service Startup & Live Database Verification)**: Verification of live local MongoDB connection, Core API startup, and structured PostgreSQL service auditing.
- **R3 (Frontend Build & Lint Validation)**: Zero-warning frontend linting (`oxlint`) and zero-error production compilation (`vite build`).
- **R4 (Targeted Remediation)**: Immediate detection of regressions in defect parsing, coordinate projection, or API schemas.
- **R5 (End-to-End Browser & 3D Twin Verification)**: Exact mathematical and data pipeline consistency for spatial binning, PDF reporting, and Three.js cylindrical projection ($R = 2.95\text{ m}$).
- **R6 (Git Attribution & Final Summary)**: Structured reporting and commit validation ensuring attribution to `Devansh Geria <devanshgeria510@gmail.com>`.

### 1.3 Progressive Testability & Fail-Fast Cascading
Tests are structured into hierarchical tiers (Tier 1 through Tier 4). Tiers are ordered by dependency and speed:
1. Fast local checks (Tier 1 unit contracts and builds) fail immediately before invoking complex cross-service flows.
2. Boundary and defensive guards (Tier 2) validate input sanitization before network orchestration.
3. Live daemon and database integration (Tier 3) verify socket connectivity.
4. Full system workload pipelines (Tier 4) exercise the multi-stage end-to-end data lifecycle.

### 1.4 Test Isolation & Idempotence
All integration tests maintain independent runtime states. Ingestion tests into live MongoDB instances use unique test identifiers and self-cleaning teardown routines. Ephemeral ports (or port 0) are used during API route testing to eliminate port collisions with running production services.

---

## 2. Feature Inventory Mapping (Tiers 1 – 4)

| Tier | Category | Feature ID | Target Component | Description | Verification Method |
|------|----------|------------|------------------|-------------|---------------------|
| **Tier 1** | Feature Coverage | F1.1 | `backend/src/api.test.js` | API contract, security headers, rate limiting, and CORS allowlist | Subprocess exit code `0`, 12/12 assertions pass |
| **Tier 1** | Feature Coverage | F1.2 | `backend/src/routes/spatial.test.js` | Geotechnical chainage binning logic and risk classification | Subprocess exit code `0`, 22/22 assertions pass |
| **Tier 1** | Feature Coverage | F1.3 | `frontend/src` | Frontend static code quality and lint compliance | `npx oxlint` exit code `0`, 0 warnings, 0 errors |
| **Tier 1** | Feature Coverage | F1.4 | `frontend/` | Frontend production asset compilation | `npm run build` exit code `0`, asset bundle verification |
| **Tier 1** | Feature Coverage | F1.5 | `ai_pipeline/predict.py` | Computer vision model inference with `best.pt` | Python inference run on sample dataset image, exit `0` |
| **Tier 2** | Boundary & Corner Cases | F2.1 | `backend/src/routes/detections.js` | Invalid detection payload rejection (schema constraints) | Express-validator HTTP 400 responses on invalid inputs |
| **Tier 2** | Boundary & Corner Cases | F2.2 | `backend/src/middleware/validate.js` | SQL injection and malicious UUID rejection | Input sanitization rejects malformed / injection payloads |
| **Tier 2** | Boundary & Corner Cases | F2.3 | `backend/src/routes/spatial.js` | Spatial binning bounds (5m–50m intervals, empty bins, nulls) | Aggregator correctly partitions edges and ignores null coords |
| **Tier 2** | Boundary & Corner Cases | F2.4 | `frontend/src/pages/dashboard/InspectionVideos.jsx` | 1-based frame indexing bounds (frames 1 to 192) | Clamping logic enforces bounds $[1, 192]$ and matches webp files |
| **Tier 3** | Cross-Component Integration | F3.1 | MongoDB Service | MongoDB local connection (`mongodb://127.0.0.1:27017/hrt_inspection`) | Live ping and collection read/write via MongoClient |
| **Tier 3** | Cross-Component Integration | F3.2 | `api/server.js` | Ingestion Gateway `/api/detections` POST & GET verification | Live HTTP POST 201 creation and GET retrieval |
| **Tier 3** | Cross-Component Integration | F3.3 | `backend/src/index.js` | Core API `/health` endpoint verification | HTTP 200 `{ status: 'ok', service: 'HRT Inspection API' }` |
| **Tier 3** | Cross-Component Integration | F3.4 | PostgreSQL Service | PostgreSQL service audit status logging | TCP socket probe on `127.0.0.1:5432` with audit logging |
| **Tier 4** | Real-World System Workload | F4.1 | Pipeline Lifecycle | Ingestion -> Query -> Spatial Binning -> PDF Report Export | End-to-end data transformation returning valid `%PDF-` |
| **Tier 4** | Real-World System Workload | F4.2 | `frontend/src/pages/twin/TunnelTwin.jsx` | Three.js Digital Twin coordinate verification ($R=2.95\text{m}$, $+Z$) | Exact clock-face angle trigonometric invariants |

---

## 3. Test Architecture & Runner Specifications

```
                              ┌────────────────────────────────────────┐
                              │         scripts/verify_all.js          │
                              │    (Master System Test Orchestrator)   │
                              └───────────────────┬────────────────────┘
                                                  │
         ┌────────────────────────┬───────────────┴───────────────┬────────────────────────┐
         │                        │                               │                        │
         ▼                        ▼                               ▼                        ▼
┌──────────────────┐    ┌──────────────────┐            ┌──────────────────┐    ┌──────────────────┐
│ tests/tier1_...  │    │ tests/tier2_...  │            │ tests/tier3_...  │    │ tests/tier4_...  │
│ Feature Coverage │    │ Boundary/Corner  │            │ Integration Live │    │ Real Workload    │
├──────────────────┤    ├──────────────────┤            ├──────────────────┤    ├──────────────────┤
│ • API Contracts  │    │ • HTTP 400 guards│            │ • MongoDB Ping   │    │ • Full Pipeline  │
│ • Spatial Logic  │    │ • SQLi / UUIDs   │            │ • Ingest POST/GET│    │ • PDF Report Gen │
│ • Frontend Lint  │    │ • Binning Bounds │            │ • Core Health    │    │ • Three.js Twin  │
│ • Frontend Build │    │ • Frame 1-192    │            │ • Postgres Audit │    │   Coordinates    │
│ • Model Inference│    │                  │            │                  │    │   (R=2.95m, +Z)  │
└──────────────────┘    └──────────────────┘            └──────────────────┘    └──────────────────┘
```

### 3.1 Runner CLI Syntax
The test suite can be run in its entirety or tier-by-tier:

```powershell
# Run the complete test suite (Tiers 1 to 4)
node scripts/verify_all.js

# Run individual tiers
node scripts/verify_all.js --tier=1
node scripts/verify_all.js --tier=2
node scripts/verify_all.js --tier=3
node scripts/verify_all.js --tier=4

# Run standalone test modules
node tests/tier1_feature.test.js
node tests/tier2_boundary.test.js
node tests/tier3_integration.test.js
node tests/tier4_workload.test.js
```

### 3.2 Output Format & Telemetry
Every runner invocation outputs:
- ANSI color-coded status badges (`[PASS]`, `[FAIL]`, `[AUDIT]`).
- Individual assertion descriptions.
- Millisecond-level execution duration per test and tier.
- An aggregated executive summary table.
- Non-zero process exit code (`1`) on any fatal failure, and `0` on 100% passing tests.

---

## 4. Coverage Thresholds & Quality Gates

| Metric | Target Gate | Description |
|--------|-------------|-------------|
| **Tier 1 Unit & Contract Tests** | 100% Pass (34/34 assertions) | `api.test.js` (12/12) and `spatial.test.js` (22/22) must pass with zero failures. |
| **Frontend Static Quality** | 0 Errors, 0 Warnings | Oxlint must analyze all JSX/JS files in `frontend/src` with 0 reported issues. |
| **Frontend Build Output** | 100% Success | Vite production build must complete with exit code 0 and emit valid chunks. |
| **AI Inference Execution** | 100% Success | YOLOv8 pipeline must run against `best.pt` on CPU/CUDA and write telemetry. |
| **Tier 2 Boundary Tests** | 100% Pass | All invalid schema combinations and SQL injection payloads must be rejected. |
| **Database Connectivity** | Live Active | MongoDB on `127.0.0.1:27017` must respond to ping within 2,000 ms. |
| **Twin Coordinate Precision** | $\Delta < 10^{-6}\text{ m}$ | Radial projection must equal exactly $2.95\text{ m}$ across all angular offsets. |
| **PDF Report Integrity** | Magic Header `%PDF-` | Generated report stream must produce a valid non-empty PDF document buffer. |

---

## 5. Continuous Verification & Operational Guardrails

1. **Pre-Commit Verification**: Developers and agents must run `npm test` and `npx --prefix frontend oxlint frontend/src` before committing.
2. **Attribution Guard**: All commits must be authored by `Devansh Geria <devanshgeria510@gmail.com>`.
3. **No Unsafe SQL**: All SQL statements in `backend/src/` must remain strictly parameterized ($1, $2). String formatting/concatenation into queries is forbidden.
4. **Disposal of GPU/WebGL Resources**: Three.js components must cleanly deallocate geometries, textures, and render targets upon unmounting to prevent memory leaks in the browser environment.
