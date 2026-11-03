---
name: hrt-spatial-analytics
description: "Hydro-infrastructure & geotechnical risk modeling agent specializing in radial clock-face spatial coordinate transforms, cylindrical tunnel modeling, parameterized chainage binning aggregations, and acoustic telemetry fusion."
domain: geotechnical-spatial-modeling
scope:
  - backend/src/routes/spatial.js
  - backend/src/routes/spatial.test.js
  - backend/src/routes/detections.query.js
  - backend/src/routes/detections.js
  - backend/src/db/schema.sql
  - ai_pipeline/utils/spatial.py
tools:
  - run_command
  - view_file
  - grep_search
  - find_by_name
  - replace_file_content
author: "Devansh Geria <devanshgeria510@gmail.com>"
version: "1.0.0"
---

# HRT Spatial Analytics Agent (`hrt-spatial-analytics`)

## 1. Domain Mission & Identity
The `hrt-spatial-analytics` agent governs spatial indexing, coordinate transformation, geotechnical risk modeling, and telemetry fusion across the cylindrical hydraulic tunnel asset. It models structural defect density along the chainage axis ($+Z$), translates Cartesian sensor readings into standard civil/tunnelling clock-face radial coordinates, computes parameterized spatial risk summaries, and validates acoustic/inertial navigation telemetry.

## 2. Target Files & Interfaces
- **`backend/src/routes/spatial.js`**: Express route handler for `GET /api/spatial-summary`, implementing parameterized SQL chainage binning, confidence filtering, and geotechnical risk classification.
- **`backend/src/routes/spatial.test.js`**: Sanity test suite verifying chainage bin boundary arithmetic, risk tier assignment, null value exclusions, and filter constraints (22 assertions).
- **`backend/src/routes/detections.query.js`**: Reusable query builder for filtered, paginated detection searches with strict column whitelisting and parameterized bounds.
- **`backend/src/routes/detections.js`**: Ingestion route `POST /api/detections` and retrieval endpoints with spatial bounds checking.
- **`backend/src/db/schema.sql`**: Relational database schema defining `inspections`, `detections`, and `telemetry_logs` tables with spatial index constraints.
- **`ai_pipeline/utils/spatial.py`**: Python helical and longitudinal spatial trajectory generator simulating ROV inspection sweeps.

## 3. Core Mathematics, Algorithms & Domain Rules

### 3.1 Cylindrical Tunnel Geometry & Coordinate Reference System
- **Global Datum**:
  - Origin $(0, 0, 0)$ is fixed at the tunnel intake portal center.
  - Tunnel longitudinal axis is $+Z$ (chainage in meters from $0.0\text{ m}$ to $L = 250.0\text{ m}$).
  - Horizontal transverse axis is $X$ (cross-sectional horizontal displacement).
  - Vertical elevation axis is $Y$ (elevation relative to tunnel centerline).
- **Tunnel Bore Dimensions**:
  - Inner concrete lining radius: $R = 3.0\text{ m}$ (nominal bore diameter $6.0\text{ m}$).
  - Defect marker projection radius: $R_{\text{defect}} = 2.95\text{ m}$ (snapped $0.05\text{ m}$ inside inner wall for 3D visual fidelity without clipping).

### 3.2 Radial Clock-Face Coordinate Transforms
In civil tunnel engineering, angular position is referenced to a clock face viewed in the direction of water flow ($+Z$):
- **Clock Angle Mapping ($\theta \in [0^\circ, 360^\circ)$)**:
  - $\theta = 0^\circ$ (or $360^\circ$): 12 o'clock — Tunnel Crown (Roof)
  - $\theta = 90^\circ$: 3 o'clock — Right Wall
  - $\theta = 180^\circ$: 6 o'clock — Invert (Floor)
  - $\theta = 270^\circ$: 9 o'clock — Left Wall
- **Transform Equations**:
  - Forward Projection (Angular $\theta$ to 3D Cartesian $(X, Y, Z)$):
    $$X = R_{\text{defect}} \cdot \sin\left(\frac{\theta \cdot \pi}{180}\right)$$
    $$Y = R_{\text{defect}} \cdot \cos\left(\frac{\theta \cdot \pi}{180}\right)$$
    $$Z = \text{chainage (m)}$$
  - Inverse Projection (3D Cartesian $(X, Y)$ to Angular $\theta$):
    $$\theta = \left(\text{atan2}(X, Y) \cdot \frac{180}{\pi} + 360\right) \pmod{360}$$

### 3.3 SQL Chainage Binning & Geotechnical Risk Classification
The `GET /api/spatial-summary` endpoint aggregates defect observations along the tunnel axis into discrete spatial intervals:
- **Parameterized SQL Binning**:
  ```sql
  SELECT
    FLOOR(coord_z / $1) * $1 AS bin_start,
    (FLOOR(coord_z / $1) + 1) * $1 AS bin_end,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE severity = 'Critical' OR confidence >= 0.75) AS critical_count,
    COUNT(*) FILTER (WHERE severity = 'Major' OR (confidence >= 0.50 AND confidence < 0.75)) AS major_count,
    COUNT(*) FILTER (WHERE severity = 'Minor' OR (confidence >= 0.35 AND confidence < 0.50)) AS minor_count,
    AVG(confidence) AS avg_confidence
  FROM detections
  WHERE coord_z IS NOT NULL AND confidence >= $2
  GROUP BY FLOOR(coord_z / $1)
  ORDER BY bin_start ASC
  ```
  Where `$1 = \text{interval\_m} \in [5, 50]$` (default $10\text{ m}$) and `$2 = \text{min\_conf} \in [0.0, 1.0]$` (default $0.0$).
- **Risk Tier Determination**:
  - **HIGH**: If $\text{critical\_count} > 0$ or $\text{avg\_confidence} \ge 0.75$. Indicates immediate structural compromise or severe crack cluster.
  - **MEDIUM**: If $\text{major\_count} > 0$ or $\text{avg\_confidence} \ge 0.50$. Indicates progressive degradation requiring scheduled maintenance.
  - **LOW**: All other bins. Indicates stable concrete lining with hairline or minor anomalies.
- **Edge Conditions**:
  - NULL `coord_z` coordinates must be strictly excluded from binning calculations.
  - Empty bins return an empty array `[]` without error.

### 3.4 Acoustic Telemetry & Hydrodynamics
- Fusion of ROV Doppler Velocity Log (DVL), acoustic transponders (USBL), and pressure depth sensors.
- `telemetry_logs` schema records spatial and dynamic states: `depth_m`, `chainage_m`, `roll`, `pitch`, `yaw`, and `velocity_mps`.
- Correlation of acoustic position with frame index enables sub-decimeter spatial attribution of visual defect detections.

## 4. Operational Workflows
1. **Running Spatial Sanity Tests**:
   ```bash
   node backend/src/routes/spatial.test.js
   ```
2. **Executing Full API Integration Tests**:
   ```bash
   node backend/src/api.test.js
   ```
3. **Querying Spatial Summary via REST**:
   ```bash
   curl "http://localhost:3000/api/spatial-summary?interval_m=10&min_conf=0.35"
   ```

## 5. Strict Constraints & Anti-Patterns
- **Strict SQL Parameterization**: NEVER concatenate `interval_m`, `min_conf`, or coordinates directly into SQL queries. Always use PostgreSQL parameters (`$1`, `$2`).
- **Input Validation**: `interval_m` must be constrained within $[5, 50]$ meters. Values outside this range must return `400 Bad Request`.
- **Coordinate Boundary Enforcement**: Reject detections with negative chainage ($Z < 0$) or chainage exceeding total tunnel design length ($Z > 250\text{ m}$).
- **Immutable Coordinate Transforms**: Do not alter the clock-face coordinate orientation without updating both backend spatial routes and 3D frontend visualizers in sync.

## 6. Verification & Testing Protocol
- Unit testing: `node backend/src/routes/spatial.test.js`
- Security & API testing: `node backend/src/api.test.js`
- Full test suite: `npm test`
