from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from ws.hub import agent_hub

router = APIRouter(prefix="/api/files", tags=["files"], dependencies=[Depends(get_current_user)])


class FileListRequest(BaseModel):
    machine_id: str
    path: str = "."


class FileWriteRequest(BaseModel):
    machine_id: str
    path: str
    content: str


@router.post("/list")
async def list_files(body: FileListRequest):
    """请求 Agent Daemon 列出目录内容。"""
    result = await agent_hub.request(body.machine_id, {
        "type": "file_list",
        "path": body.path,
    })
    if result is None:
        raise HTTPException(503, "机器不在线")
    return result


@router.post("/read")
async def read_file(body: FileListRequest):
    """请求 Agent Daemon 读取文件内容。"""
    result = await agent_hub.request(body.machine_id, {
        "type": "file_read",
        "path": body.path,
    })
    if result is None:
        raise HTTPException(503, "机器不在线")
    return result


@router.post("/write")
async def write_file(body: FileWriteRequest):
    """请求 Agent Daemon 写入文件。"""
    result = await agent_hub.request(body.machine_id, {
        "type": "file_write",
        "path": body.path,
        "content": body.content,
    })
    if result is None:
        raise HTTPException(503, "机器不在线")
    return result
