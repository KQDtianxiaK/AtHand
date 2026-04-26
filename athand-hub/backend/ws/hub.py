"""
WebSocket Hub：管理 Agent Daemon 连接。
- /ws/agent/{machine_id}?token=xxx  → Agent Daemon 连入
"""
from __future__ import annotations

import datetime as dt
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from config import settings

logger = logging.getLogger("ws.hub")
router = APIRouter()


class AgentHub:
    """管理所有 Agent Daemon WebSocket 连接。"""

    def __init__(self):
        # machine_id → WebSocket
        self.agents: dict[str, WebSocket] = {}

    async def connect_agent(self, machine_id: str, ws: WebSocket):
        self.agents[machine_id] = ws
        logger.info("Agent connected: %s", machine_id)

    def disconnect_agent(self, machine_id: str):
        self.agents.pop(machine_id, None)
        logger.info("Agent disconnected: %s", machine_id)


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
