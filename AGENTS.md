# Agent Instructions

## Package Manager
Use **npm**:
- Frontend: `npm --prefix frontend install`, `npm --prefix frontend run dev`, `npm --prefix frontend run build`
- Backend: `npm --prefix backend install`, `npm --prefix backend start`
- Root / API: `npm install`

## Domain Agents Directory
Specialized domain agent specifications located in `.agents/`:
| Agent | Domain Role | Scope | Specification |
|-------|-------------|-------|---------------|
| `hrt-vision-pipeline` | Computer Vision & Edge AI | `ai_pipeline/` | `.agents/hrt-vision-pipeline.md` |
| `hrt-spatial-analytics` | Geotechnical & Spatial Modeling | `backend/src/routes/spatial*`, `backend/src/db/` | `.agents/hrt-spatial-analytics.md` |
| `hrt-webgl-twin` | 3D Graphics & GPU Performance | `frontend/src/pages/twin/` | `.agents/hrt-webgl-twin.md` |
| `hrt-compliance-audit` | Regulatory Compliance & Audit | `backend/src/routes/reports*`, `inspections*` | `.agents/hrt-compliance-audit.md` |

## File-Scoped Commands
| Task | Scope | Command |
|------|-------|---------|
| Lint frontend file | `hrt-webgl-twin` | `npx --prefix frontend oxlint path/to/file.jsx` |
| Build check | Frontend | `npm --prefix frontend run build` |
| Unit test API & reports | `hrt-compliance-audit` | `node backend/src/api.test.js` |
| Unit test spatial routes | `hrt-spatial-analytics` | `node backend/src/routes/spatial.test.js` |
| Model inference | `hrt-vision-pipeline` | `python ai_pipeline/predict.py --weights <pt> --source <video>` |
| Model ONNX export | `hrt-vision-pipeline` | `python ai_pipeline/export_model.py --format onnx --half` |
| Full test suite | Multi-domain | `npm test` |

## Commit Attribution
All git commits MUST be authored by:
```
Shagun <shagunsoni197@gmail.com>
```
Git author flag: `--author="Shagun <shagunsoni197@gmail.com>"`

## Key Conventions
- **3D Graphics & Memory**: Three.js components (`frontend/src/pages/twin/`) must safely traverse and dispose geometries, materials, and textures (`map`, `bumpMap`) upon unmount.
- **Backend Architecture**: Express REST API (`backend/src/`). All SQL queries must be strictly parameterized (`$1`, `$2`). Never concatenate user input into SQL or query builders.
- **Spatial Coordinates**: Origin `(0, 0, 0)` is at intake. Tunnel axis is `+Z` (chainage in meters). Defect markers project radially at `DEFECT_R = 2.95m` with clock-face angular mapping.
- **Error Resilience**: React error boundaries guard page crashes; API endpoints return JSON error objects (`400`/`404`/`503`) without unhandled crashes.
