# HRT Inspection System — Backend API

REST API for the **Head Race Tunnel (HRT) AI Inspection System**.  
Built with **Node.js + Express + PostgreSQL**.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 LTS |
| npm | ≥ 9 |
| PostgreSQL | ≥ 14 |

---

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set DB_PASSWORD (and any other values) for your local Postgres
```

### 3. Create the database

```bash
psql -U postgres -c "CREATE DATABASE hrt_inspection;"
```

### 4. Apply the schema

```bash
psql -U postgres -d hrt_inspection -f src/db/schema.sql
```

---

## Running the Server

```bash
# Production
npm start

# Development (auto-restart on file changes via nodemon)
npm run dev
```

Server starts on **http://localhost:3000** (override with `PORT=` in `.env`).

---

## Endpoints

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| `GET`  | `/health` | ✅ Live | Health check |
| `POST` | `/api/detections` | ✅ Live | Ingest a detection event from the AI pipeline |
| `GET`  | `/api/spatial-summary` | 🔜 Planned | Spatial heat-map aggregate |
| `*`    | `/api/inspections` | 🔜 Planned | Inspection session CRUD |

### POST `/api/detections`

**Request body** (sent by `ai_pipeline/api_client.py`):

```json
{
  "class_label": "crack",
  "confidence": 0.87,
  "bbox": { "x1": 120.5, "y1": 80.2, "x2": 340.1, "y2": 200.8,
            "width": 219.6, "height": 120.6 },
  "frame_index": 142,
  "timestamp": "2026-10-31T08:00:00Z",
  "x": 1.23,
  "y": -0.45,
  "z": 45.30
}
```

**Responses:**

| Code | Meaning |
|------|---------|
| `201 Created` | Detection persisted — returns `{ success, detection_id, created_at }` |
| `400 Bad Request` | Validation error — returns `{ error, errors[] }` |
| `503 Service Unavailable` | PostgreSQL unreachable — returns `{ error, detail }` |

---

## Project Structure

```
backend/
├── .env.example          # Environment variable template
├── package.json
└── src/
    ├── index.js           # Express app bootstrap & server
    ├── db/
    │   ├── pool.js        # Shared pg.Pool + query() helper
    │   └── schema.sql     # DDL — run once to create tables & indexes
    └── routes/
        └── detections.js  # POST /api/detections (Module 3)
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the server listens on |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `hrt_inspection` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | *(empty)* | Database password |
| `NODE_ENV` | `development` | Set to `production` to suppress internal error details |
