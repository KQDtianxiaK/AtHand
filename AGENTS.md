# Repository Guidelines

## Project Structure & Module Organization

This workspace centers on `athand-hub/`, a FastAPI + React application. Backend code lives in `athand-hub/backend/`: API routers are in `api/`, integration logic in `services/`, and shared database/config code in `database.py`, `models.py`, and `config.py`. Frontend code lives in `athand-hub/frontend/src/`: pages in `pages/`, reusable UI in `components/`, hooks in `hooks/`, context providers in `context/`, and API helpers in `api/`. Static frontend files are under `frontend/public/`; deployment helpers are in `deploy/`. Root folders such as `paseo-main/`, `follow-builders-main/`, and `vibe-kanban-main/` are separate imported projects; avoid changing them unless explicitly targeted.

## Build, Test, and Development Commands

Run commands from `athand-hub/` unless noted:

- `make init`: copy `.env.example`, install dependencies, and initialize SQLite.
- `make dev-backend`: start FastAPI with reload on port `8000`.
- `make dev-frontend`: start Vite on port `5173`.
- `make build`: run `tsc` and create the production frontend bundle in `frontend/dist/`.
- `make run`: start the production backend server.
- `cd frontend && npm run preview`: preview a built frontend bundle locally.

## Coding Style & Naming Conventions

Python uses 4-space indentation, type hints where useful, and snake_case for modules, functions, and variables. Keep FastAPI route files grouped by domain, for example `api/todos.py` and `api/news.py`. React/TypeScript uses 2-space indentation, PascalCase component filenames such as `AssistantPanel.tsx`, and camelCase variables/functions. Prefer existing Tailwind patterns and theme tokens from `src/index.css`; keep page state in `pages/` and shared behavior in `components/`, `hooks/`, or `context/`.

## Testing Guidelines

There is no committed test runner for `athand-hub` yet. Before submitting changes, run `cd athand-hub/frontend && npm run build` to catch TypeScript and bundling errors. For backend changes, start `make dev-backend` and verify relevant endpoints, including `/api/health`. When adding tests, place backend tests under `athand-hub/backend/tests/` as `test_*.py`, and frontend tests beside components as `*.test.tsx` or under `src/__tests__/`.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style messages such as `feat(frontend): redesign embedded assistant panel`, `fix(frontend): stabilize email workspace loading`, and `docs: summarize V3 strategy in README`. Follow `type(scope): summary` with scopes like `frontend`, `backend`, or `docs`. Pull requests should describe the change, list verification commands, link related issues or notes, and include screenshots for visible UI changes.

## Security & Configuration Tips

Do not commit `athand-hub/.env`, tokens, email credentials, or local database files. Use `athand-hub/.env.example` as the configuration template. Development CORS is permissive in `backend/main.py`; tighten it for production deployments.

## V3 Phase Tracking

Use `docs/athand-v3-phase-plan.md` as the running development plan for AtHand V3. After each completed conversation round that changes strategy, implementation, verification, or open questions, update the relevant phase's `Progress` and `Open Items` sections before finishing. After any context compaction or resumed session, read `docs/athand-v3-phase-plan.md` first to recover current phase, recent progress, and next steps before continuing work.
