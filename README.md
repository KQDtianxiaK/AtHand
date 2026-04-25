# AtHand

This repository tracks the current local integration work for AtHand.

## Layout

- `athand-hub/`: the main AtHand application (FastAPI backend, React frontend, legacy agent daemon)
- `paseo-main/`: the local working copy of paseo used for the AI control bridge and Kimi provider work
- `.vscode/tasks.json`: a shared task for starting the local paseo daemon

## Current Focus

The current integration state includes:

- AtHand backend to paseo daemon bridge routes under `/api/ai-control`
- Kimi Code provider wired into paseo and validated through create, send, and resume flows
- AtHand frontend bridge-first AI control panel running against the bridge API
- direct browser access for SPA routes such as `/agents`

## Local Development

### Backend

Run the AtHand backend on port 8000:

```bash
cd athand-hub/backend
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### Paseo daemon

Run the local paseo daemon on port 6767:

```bash
cd paseo-main
PASEO_HOME=/home/kangkai/AtHand/.paseo-athand \
PASEO_LISTEN=127.0.0.1:6767 \
PASEO_RELAY_ENABLED=0 \
PASEO_DICTATION_ENABLED=0 \
PASEO_VOICE_MODE_ENABLED=0 \
PASEO_NODE_INSPECT=0 \
npx -y -p node@22 -p npm@10 bash -lc 'npm run dev --workspace=@getpaseo/server -- --no-mcp'
```

### Frontend dev server

Run Vite on port 5173:

```bash
cd athand-hub/frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

The Vite dev server proxies `/api` and `/ws` to the backend on port 8000.