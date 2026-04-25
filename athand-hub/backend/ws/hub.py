"""
WebSocket Hub：管理 Agent Daemon 连接、前端 Dashboard 连接。
- /ws/agent/{machine_id}?token=xxx  → Agent Daemon 连入
- /ws/dashboard?token=xxx           → 前端实时推送
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from config import settings

logger = logging.getLogger("ws.hub")
router = APIRouter()


class AgentHub:
    """管理所有 Agent Daemon 和 Dashboard 的 WebSocket 连接。"""

    def __init__(self):
        # machine_id → WebSocket
        self.agents: dict[str, WebSocket] = {}
        # 前端 dashboard 连接列表
        self.dashboards: list[WebSocket] = []
        # machine_id → 待响应 future（用于 request/response 模式）
        self._pending: dict[str, asyncio.Future] = {}

    async def connect_agent(self, machine_id: str, ws: WebSocket):
        self.agents[machine_id] = ws
        logger.info("Agent connected: %s", machine_id)
        await self.broadcast_dashboard({"type": "agent_online", "machine_id": machine_id})

    def disconnect_agent(self, machine_id: str):
        self.agents.pop(machine_id, None)
        logger.info("Agent disconnected: %s", machine_id)
        # 广播离线（fire-and-forget）
        asyncio.create_task(
            self.broadcast_dashboard({"type": "agent_offline", "machine_id": machine_id})
        )

    async def connect_dashboard(self, ws: WebSocket):
        self.dashboards.append(ws)
        # 发送当前在线机器列表
        await ws.send_json({"type": "agents_list", "agents": list(self.agents.keys())})

    def disconnect_dashboard(self, ws: WebSocket):
        if ws in self.dashboards:
            self.dashboards.remove(ws)

    async def broadcast_dashboard(self, data: dict):
        """向所有前端 dashboard 广播消息。"""
        dead = []
        for ws in self.dashboards:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_dashboard(ws)

    async def send_task(self, machine_id: str, task_data: dict) -> bool:
        """向指定 Agent 发送任务。返回是否发送成功。"""
        ws = self.agents.get(machine_id)
        if not ws:
            return False
        try:
            await ws.send_json(task_data)
            return True
        except Exception:
            self.disconnect_agent(machine_id)
            return False

    async def request(self, machine_id: str, data: dict, timeout: float = 30) -> dict | None:
        """向 Agent 发送请求并等待响应（用于文件操作等同步请求）。"""
        ws = self.agents.get(machine_id)
        if not ws:
            return None
        # 创建唯一请求 ID
        import uuid
        req_id = str(uuid.uuid4())
        data["req_id"] = req_id
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = fut
        try:
            await ws.send_json(data)
            return await asyncio.wait_for(fut, timeout=timeout)
        except (asyncio.TimeoutError, Exception):
            return None
        finally:
            self._pending.pop(req_id, None)

    def resolve_request(self, req_id: str, data: dict):
        """Agent 返回响应时调用。"""
        fut = self._pending.get(req_id)
        if fut and not fut.done():
            fut.set_result(data)


# 全局单例
agent_hub = AgentHub()


# ---------- Agent Daemon WebSocket 端点 ----------
@router.websocket("/ws/agent/{machine_id}")
async def ws_agent(ws: WebSocket, machine_id: str, token: str = Query(...)):
    if token != settings.agent_token:
        await ws.close(code=4001, reason="认证失败")
        return
    await ws.accept()
    await agent_hub.connect_agent(machine_id, ws)

    # 注册/更新机器信息到数据库
    from database import SessionLocal
    from models import Machine
    db = SessionLocal()
    try:
        machine = db.query(Machine).filter(Machine.id == machine_id).first()
        if not machine:
            machine = Machine(id=machine_id, name=machine_id)
            db.add(machine)
        machine.is_online = True
        machine.last_heartbeat = dt.datetime.now(dt.timezone.utc)
        db.commit()
    finally:
        db.close()

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "")

            if msg_type == "heartbeat":
                # 更新心跳
                db = SessionLocal()
                try:
                    machine = db.query(Machine).filter(Machine.id == machine_id).first()
                    if machine:
                        machine.last_heartbeat = dt.datetime.now(dt.timezone.utc)
                        machine.is_online = True
                        db.commit()
                finally:
                    db.close()

            elif msg_type == "task_output":
                # Kimi Code 流式输出 → 转发给 dashboard + 存储到数据库
                await agent_hub.broadcast_dashboard({
                    "type": "task_output",
                    "machine_id": machine_id,
                    "task_id": data.get("task_id"),
                    "message": data.get("message"),
                })
                # 存消息到 DB
                _save_message(data)

            elif msg_type == "task_done":
                await agent_hub.broadcast_dashboard({
                    "type": "task_done",
                    "machine_id": machine_id,
                    "task_id": data.get("task_id"),
                    "exit_code": data.get("exit_code"),
                })
                _finish_task(data)

            elif msg_type == "response":
                # 文件操作等同步请求的响应
                req_id = data.get("req_id")
                if req_id:
                    agent_hub.resolve_request(req_id, data.get("data", {}))

            elif msg_type == "system_info":
                await agent_hub.broadcast_dashboard({
                    "type": "system_info",
                    "machine_id": machine_id,
                    "info": data.get("info"),
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("Agent WS error: %s", e)
    finally:
        agent_hub.disconnect_agent(machine_id)
        # 标记离线
        db = SessionLocal()
        try:
            machine = db.query(Machine).filter(Machine.id == machine_id).first()
            if machine:
                machine.is_online = False
                db.commit()
        finally:
            db.close()


def _save_message(data: dict):
    from database import SessionLocal
    from models import Message
    db = SessionLocal()
    try:
        msg = data.get("message", {})
        # Kimi Code 的 content 可能是 list/dict，需要序列化为 JSON 字符串
        content = msg.get("content")
        if isinstance(content, (list, dict)):
            content = json.dumps(content, ensure_ascii=False)
        m = Message(
            task_id=data.get("task_id"),
            role=msg.get("role", "assistant"),
            content=content,
            tool_calls=json.dumps(msg.get("tool_calls"), ensure_ascii=False) if msg.get("tool_calls") else None,
            tool_call_id=msg.get("tool_call_id"),
        )
        db.add(m)
        db.commit()
    except Exception as e:
        logger.warning("保存消息失败: %s", e)
        db.rollback()
    finally:
        db.close()


def _finish_task(data: dict):
    from database import SessionLocal
    from models import Task
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == data.get("task_id")).first()
        if task:
            task.status = "done" if data.get("exit_code", 1) == 0 else "failed"
            task.exit_code = data.get("exit_code")
            new_sid = data.get("session_id")
            if new_sid:  # 只在 daemon 报告了新 session_id 时才更新，避免覆盖为 None
                task.session_id = new_sid
            task.finished_at = dt.datetime.now(dt.timezone.utc)
            db.commit()
    finally:
        db.close()


# ---------- Dashboard WebSocket 端点 ----------
@router.websocket("/ws/dashboard")
async def ws_dashboard(ws: WebSocket, token: str = Query(...)):
    # 验证 JWT
    from jose import JWTError, jwt as jose_jwt
    try:
        jose_jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        await ws.close(code=4001, reason="认证失败")
        return

    await ws.accept()
    await agent_hub.connect_dashboard(ws)
    try:
        while True:
            # Dashboard 端也可以发消息（如请求刷新）
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        agent_hub.disconnect_dashboard(ws)
