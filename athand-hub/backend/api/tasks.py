from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import Message, Task
from ws.hub import agent_hub

router = APIRouter(prefix="/api/tasks", tags=["tasks"], dependencies=[Depends(get_current_user)])


class TaskCreate(BaseModel):
    machine_id: str
    prompt: str
    work_dir: str | None = None
    mode: str = "normal"  # normal / plan / continue
    session_id: str | None = None  # 指定 session 以继续对话


class MessageOut(BaseModel):
    id: int
    task_id: int
    role: str
    content: str | None
    tool_calls: str | None
    tool_call_id: str | None
    created_at: dt.datetime

    model_config = {"from_attributes": True}


class TaskOut(BaseModel):
    id: int
    machine_id: str
    prompt: str
    work_dir: str | None
    mode: str
    status: str
    exit_code: int | None
    session_id: str | None
    created_at: dt.datetime
    started_at: dt.datetime | None
    finished_at: dt.datetime | None

    model_config = {"from_attributes": True}


@router.post("", response_model=TaskOut)
async def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    """创建任务并通过 WebSocket 派发给对应 Agent Daemon。"""
    task = Task(
        machine_id=body.machine_id,
        prompt=body.prompt,
        work_dir=body.work_dir,
        mode=body.mode,
        session_id=body.session_id,  # 继续对话时立即绑定 session
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # 派发给 Agent
    sent = await agent_hub.send_task(body.machine_id, {
        "type": "kimi_task",
        "task_id": task.id,
        "prompt": body.prompt,
        "work_dir": body.work_dir,
        "mode": body.mode,
        "session_id": body.session_id,
    })
    if not sent:
        task.status = "failed"
        db.commit()
        raise HTTPException(503, "目标机器不在线")

    return task


@router.get("", response_model=list[TaskOut])
def list_tasks(
    machine_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(Task)
    if machine_id:
        q = q.filter(Task.machine_id == machine_id)
    if status:
        q = q.filter(Task.status == status)
    return q.order_by(Task.created_at.desc()).limit(limit).all()


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "任务不存在")
    return task


@router.get("/{task_id}/messages", response_model=list[MessageOut])
def get_task_messages(task_id: int, db: Session = Depends(get_db)):
    return db.query(Message).filter(Message.task_id == task_id).order_by(Message.id).all()


@router.get("/session/{session_id}/messages", response_model=list[MessageOut])
def get_session_messages(session_id: str, db: Session = Depends(get_db)):
    """获取一个 session 下所有任务的消息（按时间排序）。"""
    task_ids = (
        db.query(Task.id)
        .filter(Task.session_id == session_id)
        .order_by(Task.created_at)
        .all()
    )
    ids = [t[0] for t in task_ids]
    if not ids:
        return []
    return (
        db.query(Message)
        .filter(Message.task_id.in_(ids))
        .order_by(Message.id)
        .all()
    )


@router.delete("/{task_id}")
async def delete_task(task_id: int, db: Session = Depends(get_db)):
    """删除任务及其所有消息。如果任务正在运行，先通知 daemon 终止进程。"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(404, "任务不存在")
    # 如果任务还在排队/运行中，先通知 daemon 终止
    if task.status == "queued":
        await agent_hub.send_task(task.machine_id, {
            "type": "cancel_task",
            "task_id": task.id,
        })
    db.delete(task)  # cascade 会删除关联 messages
    db.commit()
    return {"ok": True}


@router.delete("/session/{session_id}")
async def delete_session(session_id: str, db: Session = Depends(get_db)):
    """删除一个 session 下的所有任务及消息。如果有运行中的任务，先通知 daemon 终止进程。"""
    tasks = db.query(Task).filter(Task.session_id == session_id).all()
    if not tasks:
        raise HTTPException(404, "会话不存在")
    # 先终止所有正在运行的任务
    for t in tasks:
        if t.status == "queued":
            await agent_hub.send_task(t.machine_id, {
                "type": "cancel_task",
                "task_id": t.id,
            })
    for t in tasks:
        db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/kill-orphan-kimi")
async def kill_orphan_kimi(machine_id: str):
    """通知 daemon 终止不在 AtHand 管理中的孤儿 kimi 进程。"""
    result = await agent_hub.request(machine_id, {"type": "kill_orphan_kimi"}, timeout=10)
    if result is None:
        raise HTTPException(503, "目标机器不在线或请求超时")
    return result
