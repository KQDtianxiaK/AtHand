
# AtHand Hub

个人全能远程工作台 — 统一管控多台机器上的 AI 编程工具，集成办公功能。

## 快速开始

### 1. 后端

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 复制配置
cd .. && cp .env.example .env
# 编辑 .env 设置密码和 token

# 启动
cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`

### 3. Agent Daemon（在目标机器上）

```bash
cd agent-daemon
cp config.example.yaml config.yaml
# 编辑 config.yaml：设置 hub_url、machine_id、agent_token

bash install.sh
# 或直接运行：python daemon.py
```

### 4. Paseo daemon（本机 AI Control bridge）

AtHand 新的 AI 管控主路径不再直接依赖旧的 agent-daemon，而是通过后端 bridge 去连接 paseo daemon。

在当前工作区里，推荐直接运行 VS Code 任务 `Start Paseo daemon (AtHand)`，或手动执行：

```bash
cd ../paseo-main
PASEO_HOME=/home/kangkai/AtHand/.paseo-athand \
PASEO_LISTEN=127.0.0.1:6767 \
PASEO_RELAY_ENABLED=0 \
PASEO_DICTATION_ENABLED=0 \
PASEO_VOICE_MODE_ENABLED=0 \
PASEO_NODE_INSPECT=0 \
npx -y -p node@22 -p npm@10 bash -lc 'npm run dev --workspace=@getpaseo/server -- --no-mcp'
```

说明：直接打开 `http://127.0.0.1:6767` 显示 `Cannot GET /` 是正常的。paseo daemon 不是首页服务，AtHand backend 实际连接的是 WebSocket 入口 `/ws`。

## 部署到 ECS

```bash
# 1. 上传代码
scp -r athand-hub/ root@ECS_IP:/opt/

# 2. 在 ECS 上
cd /opt/athand-hub
cp .env.example .env && vim .env  # 配置密码和 token

# 后端
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 前端构建
cd ../frontend && npm install && npm run build

# 启动
cd ../backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000

# 3. HTTPS（Cloudflare Tunnel）
bash ../deploy/cloudflare-tunnel.sh
cloudflared tunnel --url http://localhost:8000
```

## 架构

```
ECS 云服务器
├── FastAPI 后端（端口 8000）
├── SQLite 数据库
└── Cloudflare Tunnel（HTTPS）

各机器
└── Agent Daemon → WebSocket 出站连接 ECS
    └── 调用 kimi --print 非交互模式
```

## 功能

- **AI 管控**: 远程操控多台机器上的 Kimi Code，流式查看输出
- **文件浏览**: 远程浏览/编辑各机器上的文件
- **语音输入**: Web Speech API，所有输入框支持语音
- **待办事项**: 优先级、截止日期、分组视图
- **备忘录**: Markdown 编辑，标签搜索
- **打卡**: 上下班计时，工时统计
- **数据统计**: 任务量、成功率、工时趋势
