# HRT AI Inspection System – front end

React 19 + Vite single-page application: login and roles, inspection console (video, webcam, photo batch) with in-browser
YOLOv8n-seg inference through ONNX Runtime Web, Three.js digital twin, dashboard analytics and report export.

```powershell
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run lint       # oxlint
```

Environment variables (see `.env.example`):

| Variable | Purpose |
|---|---|
| `VITE_API_URL` / `VITE_API_BASE_URL` | Base URL of the gateway or core API |
| `VITE_AUTH_ENABLED` | `false` skips the login for local development against the core API |

`vercel.json` rewrites every path to `index.html` so deep links and refreshes work on Vercel. See the root `README.md` for the full system.
