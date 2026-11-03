# Agent Instructions

## Package Manager
Use **npm**:
- Frontend: `npm --prefix frontend install`, `npm --prefix frontend run dev`, `npm --prefix frontend run build`
- Backend: `npm --prefix backend install`, `npm --prefix backend start`
- Root / API: `npm install`

## File-Scoped Commands
| Task | Scope | Command |
|------|-------|---------|
| Lint file | Frontend | `npx --prefix frontend oxlint path/to/file.jsx` |
| Build check | Frontend | `npm --prefix frontend run build` |
| Unit test | Backend API | `node backend/src/api.test.js` |
| Unit test | Spatial routes | `node backend/src/routes/spatial.test.js` |
| Inference | AI Pipeline | `python ai_pipeline/predict.py --weights <pt> --source <video>` |

## Commit Attribution
All git commits MUST be authored by:
```
Devansh Geria <devanshgeria510@gmail.com>
```
Git author flag: `--author="Devansh Geria <devanshgeria510@gmail.com>"`

## Key Conventions
- **3D Graphics & Memory**: Three.js components (`frontend/src/pages/twin/`) must safely traverse and dispose geometries, materials, and textures (`map`, `bumpMap`) upon unmount.
- **Backend Architecture**: Express REST API (`backend/src/`). All SQL queries must be strictly parameterized (`$1`, `$2`). Never concatenate user input into SQL or query builders.
- **Spatial Coordinates**: Origin `(0, 0, 0)` is at intake. Tunnel axis is `+Z` (chainage in meters). Defect markers project radially at `DEFECT_R = 2.95m`.
- **Error Resilience**: React error boundaries guard page crashes; API endpoints return JSON error objects (`400`/`404`/`503`) without unhandled crashes.
