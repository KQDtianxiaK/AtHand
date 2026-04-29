# AtHand

<p align="center">
	<strong>AI-native remote workspace for agent orchestration and personal execution</strong>
</p>

<p align="center">
	<a href="#zh-cn">简体中文</a>
	·
	<a href="#en">English</a>
</p>

AtHand is an AI-native remote workspace that evolved from a personal productivity desk into a paseo-connected, vibe-kanban-inspired orchestration hub.

In this README, V1 means the pre-paseo / pre-vibe-kanban AtHand, and V2 means the current integrated AtHand.

<a id="zh-cn"></a>
<details open>
<summary><strong>简体中文</strong></summary>

## 项目简介

AtHand 是一个 AI 原生的个人远程工作台。它想解决的不是单一功能问题，而是把下面三类通常彼此割裂的系统收进同一张桌面：

- AI 会话、多机运行时与 provider 切换
- 个人执行流：待办、备忘录、打卡、邮件、新闻、统计
- 人与 AI 协作时需要的上下文、确认、回看与继续操作

AtHand 的目标不是做一个“功能很多的后台”，而是做一个真正能长期停留、能持续工作的日常工作台。项目名里的 AtHand，表达的是一件事：把需要的能力收在手边，而不是散落在不同窗口和不同工具里。

## 版本线

| 版本 | 定义 | 核心特征 |
| --- | --- | --- |
| V1 | 接入 paseo 和 vibe-kanban 之前的 AtHand | 原始 AtHand Hub、单体工作台、旧 AI 管控链路、个人效率工具整合 |
| V2 | 当前 AtHand | paseo sidecar bridge、vibe-kanban 式 AI 看板、timeline、统一工作台壳层、内嵌 AI 助手 |

这里的 V1 和 V2 是同一个项目的两个阶段，而不是两个彼此无关的仓库。V1 更像“带 AI 功能的个人工作台”，V2 则进一步演进成“AI orchestration + personal execution hub”。

## 产品理念

- AI-first，但不是 AI-only。AtHand 不是单独做 agent panel，而是把 AI 编排能力放回真实日常工作流中。
- Human-in-the-loop。对高风险动作保留确认与回退，例如邮件发送必须经过确认卡片，而不是直接自动执行。
- One desk, many runtimes。用户看到的是一个统一工作台，底层则允许多台机器、多种 provider、多条 AI 会话并存。
- Local-first pragmatism。AtHand 更强调真实可用和快速联调，而不是抽象成过度平台化的中间层。
- 可观察、可继续、可回看。AI 控制链路必须支持 timeline、history、状态分层和继续对话，而不只是“一次性调用”。

## 核心能力

- AI 管控：多机器、多 provider、会话创建、继续会话、timeline、history、状态看板
- 内嵌 AI 助手：全局侧边面板、SSE 流式回复、工具调用、邮件确认动作
- 个人执行模块：待办、备忘录、打卡、仪表盘统计
- 信息流模块：邮箱工作区、新闻工作区、今日速览与日报
- 统一前端壳层：sidebar + workspace + detail panel 的工作台式布局，支持主题切换、局部收起与独立滚动

## 技术栈

### Frontend

- React 19
- TypeScript
- Vite 5
- React Router 6
- Tailwind CSS
- React Markdown + remark-gfm
- DOMPurify

### Backend

- FastAPI
- Pydantic v2
- SQLAlchemy 2
- Alembic
- SQLite
- python-jose + passlib
- websockets + httpx
- feedparser + BeautifulSoup

### AI Runtime 与集成层

- paseo sidecar / daemon
- 基于 WebSocket 的 bridge-first AI control 接入
- OpenAI-compatible 模型配置与切换
- vibe-kanban 启发的 session board / timeline 交互形态

## 实现方式

### 1. 前端工作台

AtHand Hub 当前是一套 SPA。主要工作区和对应的后端边界如下：

| 工作区 | 前端入口 | 后端入口 | 说明 |
| --- | --- | --- | --- |
| 仪表盘 | `/` | `/api/stats` | 汇总本地业务数据与 AI bridge 历史 |
| AI 管控 | `/agents` | `/api/ai-control` | 多机 AI session 的创建、继续、timeline 与 provider 管理 |
| 待办 | `/todos` | `/api/todos` | 任务管理与执行清单 |
| 备忘录 | `/memos` | `/api/memos` | Markdown 记录与检索 |
| 打卡 | `/clock` | `/api/clock` | 工时记录与节奏统计 |
| 邮箱 | `/email` | `/api/email` | 账号、文件夹、邮件列表与写信工作流 |
| 新闻 | `/news` | `/api/news` | 订阅源、资讯流、速览与日报 |
| 内嵌助手 | 全局侧边面板 | `/api/assistant` | SSE 对话、工具调用、动作确认 |

### 2. AI 管控链路

V2 最重要的变化，是把 AI 管控从旧链路改造成 bridge-first 的 paseo 接入：

1. 前端 `/agents` 页负责看板、列表、timeline 和继续对话入口。
2. FastAPI 在 `/api/ai-control` 暴露机器列表、provider 列表、创建会话、发送消息、恢复会话、timeline 和 history 等接口。
3. `athand-hub/backend/services/ai_control_bridge.py` 作为桥接层，把 AtHand 的 API 模型转换为 paseo daemon 的 WebSocket RPC。
4. paseo 负责真正的 agent runtime 与 provider 接入。
5. 前端再把这些运行态组织成 vibe-kanban 风格的可视化工作区。

这条链路让 AtHand 不再只是“调用某个 AI 按钮”，而是开始具备 agent orchestration 的产品轮廓。

### 3. 内嵌 AI 助手

内嵌助手不是独立产品，而是 AtHand 的全局协作入口：

- 前端通过全局 `AssistantPanel` 常驻挂载，任何页面都可以继续对话。
- 后端 `/api/assistant/chat` 使用流式返回，把文本、tool call、tool result 和邮件确认事件推给前端。
- 工具调用可以联动待办、打卡、备忘录、统计、邮件等模块。
- 对“发送邮件”这类高风险动作，前端会进入确认卡片，再由用户决定发送、修改或取消。

### 4. 数据与后台任务

- 业务数据主要存放在 SQLite。
- FastAPI 启动时会拉起 email scheduler 与 news scheduler。
- Dashboard 会同时汇总本地业务数据与 AI bridge history，因此它既是生产力总览，也是 AI 使用总览。
- SPA 架构由 FastAPI 静态托管构建产物，并对非 `/api`、非 `/ws` 路由做 index fallback。

### 5. 为什么要区分 V1 和 V2

- V1 代表 AtHand 的原始形态：先把个人工作台搭起来，让待办、备忘录、打卡、统计和原始 AI 管控先跑通。
- V2 代表当前方向：把 agent runtime 正式外接到 paseo，把 AI 管控交互改造成 vibe-kanban 式工作流，并把整个前端壳层重构成统一语言。
- 这两个版本不是“互相替代的两个项目”，而是同一个项目的两次产品定义：V1 更偏个人工作台，V2 更偏 AI orchestration 与个人执行中心。

## 仓库结构

```text
AtHand/
├── athand-hub/        # 当前主应用：FastAPI backend + React frontend
├── paseo-main/        # 本地联调使用的 paseo 工作副本
├── vibe-kanban-main/  # vibe-kanban 交互与形态参考
├── follow-builders-main/
└── README.md
```

## 本地开发

### 1. 启动 AtHand backend

```bash
cd athand-hub/backend
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### 2. 启动 paseo daemon

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

### 3. 启动前端

```bash
cd athand-hub/frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

开发态下，Vite 会把 `/api` 和 `/ws` 代理到 `127.0.0.1:8000`。paseo daemon 默认监听 `127.0.0.1:6767`。

## 当前状态

- 如果把历史拆分来看，接入 paseo 和 vibe-kanban 之前的 AtHand 记作 V1。
- 当前仓库主线记录的是 V2：bridge-first 的 AI 管控、统一工作台前端，以及更完整的个人工作流模块。
- 这使 AtHand 从“带 AI 功能的个人工具箱”，演进成“可编排 AI，也可承载个人执行流的工作台”。

</details>

<a id="en"></a>
<details>
<summary><strong>English</strong></summary>

## Overview

AtHand is an AI-native personal remote workspace. It is built to pull three systems that are usually fragmented into the same desk:

- AI sessions, multi-machine runtimes, and provider switching
- personal execution flows such as todos, memos, clocking, email, news, and stats
- the context, confirmation, review, and continuation loops required for real human-AI collaboration

AtHand is not trying to become a generic admin dashboard with many features. The core idea is to become a workspace that can stay open all day and remain useful as a real operating surface.

## Version Line

| Version | Definition | Key traits |
| --- | --- | --- |
| V1 | AtHand before paseo and vibe-kanban integration | original AtHand Hub, monolithic workspace, legacy AI control path, integrated personal productivity tools |
| V2 | Current AtHand | paseo sidecar bridge, vibe-kanban-style AI board, timeline, unified workspace shell, embedded AI assistant |

V1 and V2 are two phases of the same product, not two unrelated repositories. V1 is closer to a personal workspace with AI features. V2 moves further toward an AI orchestration and personal execution hub.

## Product Philosophy

- AI-first, but not AI-only. AtHand does not isolate agent control from the rest of daily work.
- Human-in-the-loop. High-risk actions keep explicit confirmation and review, such as email sending.
- One desk, many runtimes. The user sees one workspace, while the system can manage multiple machines, providers, and AI sessions underneath.
- Local-first pragmatism. The project prioritizes fast iteration and working software over unnecessary platform abstraction.
- Observable, resumable, reviewable. AI control is expected to support timeline, history, session state, and continuation, not just one-shot prompts.

## Core Capabilities

- AI control across multiple machines and providers, including session creation, resume flows, timeline, history, and board-based status views
- embedded AI assistant with global side panel, SSE streaming, tool calling, and email confirmation actions
- personal execution modules for todos, memos, clocking, and dashboard statistics
- information flow modules for email workspace, news workspace, daily briefs, and digests
- unified frontend shell with sidebar + workspace + detail-panel patterns, theme switching, and independent scroll zones

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite 5
- React Router 6
- Tailwind CSS
- React Markdown + remark-gfm
- DOMPurify

### Backend

- FastAPI
- Pydantic v2
- SQLAlchemy 2
- Alembic
- SQLite
- python-jose + passlib
- websockets + httpx
- feedparser + BeautifulSoup

### AI Runtime and Integration Layer

- paseo sidecar / daemon
- bridge-first AI control over WebSocket RPC
- OpenAI-compatible model configuration and switching
- vibe-kanban-inspired session board and timeline UX

## How It Is Implemented

### 1. Frontend Workspace

AtHand Hub is currently built as a SPA. The main surfaces and their backend boundaries are:

| Surface | Frontend entry | Backend entry | Purpose |
| --- | --- | --- | --- |
| Dashboard | `/` | `/api/stats` | aggregates local business data and AI bridge history |
| AI Control | `/agents` | `/api/ai-control` | session creation, resume flows, timeline, history, and provider management |
| Todos | `/todos` | `/api/todos` | task management and execution lists |
| Memos | `/memos` | `/api/memos` | markdown note-taking and retrieval |
| Clock | `/clock` | `/api/clock` | work-hour records and rhythm tracking |
| Email | `/email` | `/api/email` | accounts, folders, message queue, and compose flow |
| News | `/news` | `/api/news` | sources, news stream, briefs, and digests |
| Embedded Assistant | global side panel | `/api/assistant` | SSE chat, tool calls, and action confirmation |

### 2. AI Control Path

The biggest V2 shift is the new bridge-first AI control architecture:

1. The `/agents` page owns the board, list, timeline, and continue-conversation entry points.
2. FastAPI exposes machine listing, provider listing, session creation, message sending, session resume, timeline, and history under `/api/ai-control`.
3. `athand-hub/backend/services/ai_control_bridge.py` translates AtHand API models into paseo daemon WebSocket RPC calls.
4. paseo is responsible for the actual agent runtime and provider integration.
5. The frontend maps those runtime states into a vibe-kanban-style visual workspace.

This is what turns AtHand from “a product with an AI button” into something closer to real agent orchestration.

### 3. Embedded AI Assistant

The embedded assistant is not a separate product. It is the global collaboration entry point inside AtHand:

- the frontend mounts `AssistantPanel` globally so the user can continue the conversation from any page
- the backend streams text, tool calls, tool results, and email confirmation events through `/api/assistant/chat`
- tool execution can operate on todos, clocking, memos, stats, email, and other workspace modules
- high-risk actions such as email sending are converted into explicit confirmation cards before final execution

### 4. Data and Background Work

- business data primarily lives in SQLite
- FastAPI startup triggers the email scheduler and the news scheduler
- the dashboard combines local business data with AI bridge history, so it acts as both a productivity overview and an AI usage overview
- built frontend assets can be served directly by FastAPI, with index fallback for non-API and non-WS routes

### 5. Why V1 and V2 Matter

- V1 represents the original AtHand shape: build the personal workspace first, make todos, memos, clocking, stats, and the original AI control path usable
- V2 represents the current direction: externalize the runtime into paseo, reshape AI control into a vibe-kanban workflow, and refactor the frontend into a consistent workspace shell
- they are not two separate products; they are two product definitions of the same project, with V1 leaning toward personal operations and V2 leaning toward AI orchestration plus personal execution

## Repository Layout

```text
AtHand/
├── athand-hub/        # main application: FastAPI backend + React frontend
├── paseo-main/        # local working copy of paseo for integration
├── vibe-kanban-main/  # interaction and product-shape reference
├── follow-builders-main/
└── README.md
```

## Local Development

### 1. Start the AtHand backend

```bash
cd athand-hub/backend
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### 2. Start the paseo daemon

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

### 3. Start the frontend

```bash
cd athand-hub/frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

In development mode, Vite proxies `/api` and `/ws` to `127.0.0.1:8000`. The paseo daemon listens on `127.0.0.1:6767` by default.

## Current Status

- If you split the project history into phases, the pre-paseo and pre-vibe-kanban AtHand is V1.
- The current mainline in this repository is V2: bridge-first AI control, a unified workspace frontend, and a broader personal workflow surface.
- That makes AtHand evolve from “a personal toolbox with AI features” into “a workspace that can orchestrate AI and carry personal execution flows at the same time”.

</details>