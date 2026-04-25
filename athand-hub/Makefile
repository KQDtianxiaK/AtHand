.PHONY: dev dev-backend dev-frontend build deploy install-daemon

# ============ 本地开发 ============
dev: dev-backend dev-frontend

dev-backend:
	cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd frontend && npm run dev

# ============ 构建 ============
build:
	cd frontend && npm run build
	@echo "✅ Frontend built to frontend/dist/"

# ============ 生产运行 ============
run:
	cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000

# ============ Agent Daemon ============
install-daemon:
	cd agent-daemon && bash install.sh

run-daemon:
	cd agent-daemon && python daemon.py

# ============ 初始化 ============
init:
	cp .env.example .env
	cd backend && pip install -r requirements.txt
	cd frontend && npm install
	cd backend && python -c "from database import init_db; init_db()"
	@echo "✅ 初始化完成！请编辑 .env 文件配置密码和 token"

# ============ 部署 ============
deploy:
	@echo "1. 上传代码到 ECS"
	@echo "2. 在 ECS 上运行: make init && make build && make run"
	@echo "3. 配置 Cloudflare Tunnel: bash deploy/cloudflare-tunnel.sh"
