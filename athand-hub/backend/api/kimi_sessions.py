"""
读取本地 Kimi Code 的历史 session 文件，提供只读浏览 API。
Session 路径: ~/.kimi/sessions/<md5(work_dir)>/<session_uuid>/
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user

router = APIRouter(
    prefix="/api/kimi-sessions",
    tags=["kimi-sessions"],
    dependencies=[Depends(get_current_user)],
)

KIMI_DIR = Path.home() / ".kimi"
SESSIONS_DIR = KIMI_DIR / "sessions"


def _load_kimi_json() -> dict:
    p = KIMI_DIR / "kimi.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def _get_work_dir_map() -> dict[str, str]:
    """返回 {md5_hash: work_dir_path}"""
    data = _load_kimi_json()
    result: dict[str, str] = {}
    for wd in data.get("work_dirs", []):
        path = wd["path"]
        h = hashlib.md5(path.encode()).hexdigest()
        result[h] = path
    return result


def _read_session_meta(session_dir: Path) -> dict:
    """读取 session 的 state.json 或 metadata.json"""
    for name in ("state.json", "metadata.json"):
        p = session_dir / name
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass
    return {}


def _extract_output_text(output: object, max_chars: int = 2000) -> str | None:
    """
    从 ToolResult 的 output 字段中提取文本。
    output 可能是：
      - str  → 直接截断
      - list → 跳过 image_url 类型，只拼接 text 类型内容
    """
    if output is None:
        return None
    if isinstance(output, str):
        return output[:max_chars] if output else None
    if isinstance(output, list):
        parts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type", "")
            if item_type == "image_url":
                # 跳过 base64 图片，替换为占位符
                parts.append("[图片]")
            elif item_type == "text":
                text = item.get("text", "")
                if text:
                    parts.append(text)
        combined = "".join(parts)
        return combined[:max_chars] if combined else None
    # fallback：转为字符串
    s = str(output)
    return s[:max_chars] if s else None


def _parse_wire_messages(wire_path: Path) -> list[dict]:
    """
    解析 wire.jsonl，提取关键消息并转换为前端可用的格式。
    返回列表，每个元素类似 TaskMessage 结构。
    """
    if not wire_path.exists() or wire_path.stat().st_size == 0:
        return []

    messages: list[dict] = []

    with open(wire_path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg = obj.get("message", obj)
            msg_type = msg.get("type", "")
            payload = msg.get("payload", {})
            ts = obj.get("timestamp")

            if msg_type == "TurnBegin":
                user_input = payload.get("user_input", "")
                # user_input 可能是字符串或列表
                if isinstance(user_input, list):
                    parts = [p.get("text", "") for p in user_input if p.get("type") == "text"]
                    user_input = "\n".join(parts)
                if user_input:
                    messages.append({
                        "role": "user",
                        "content": user_input,
                        "timestamp": ts,
                    })

            elif msg_type == "ContentPart":
                ctype = payload.get("type", "")
                if ctype == "text" and payload.get("text"):
                    messages.append({
                        "role": "assistant",
                        "content": payload["text"],
                        "timestamp": ts,
                    })
                elif ctype == "think" and payload.get("think"):
                    messages.append({
                        "role": "assistant",
                        "content": json.dumps([{"type": "think", "think": payload["think"]}]),
                        "timestamp": ts,
                    })

            elif msg_type == "ToolCall":
                fn = payload.get("function", {})
                # arguments 可能很大，截断到 500 chars
                args = fn.get("arguments", "")
                if isinstance(args, str) and len(args) > 500:
                    try:
                        args_obj = json.loads(args)
                        # 截断每个字段的值
                        for k, v in args_obj.items():
                            if isinstance(v, str) and len(v) > 200:
                                args_obj[k] = v[:200] + "…"
                        args = json.dumps(args_obj, ensure_ascii=False)
                    except Exception:
                        args = args[:500] + "…"
                trimmed_payload = {
                    **payload,
                    "function": {**fn, "arguments": args},
                }
                messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": json.dumps([trimmed_payload]),
                    "timestamp": ts,
                })

            elif msg_type == "ToolResult":
                rv = payload.get("return_value", {})
                raw_output = rv.get("output") if rv.get("output") is not None else rv.get("message")
                output_text = _extract_output_text(raw_output)
                messages.append({
                    "role": "tool",
                    "content": output_text,
                    "tool_call_id": payload.get("tool_call_id"),
                    "timestamp": ts,
                })

    return messages


@router.get("")
def list_kimi_workdirs():
    """列出所有 Kimi 工作目录及其下的会话。"""
    if not SESSIONS_DIR.exists():
        return []

    wd_map = _get_work_dir_map()
    result = []

    for dir_hash in sorted(SESSIONS_DIR.iterdir()):
        if not dir_hash.is_dir():
            continue
        hash_name = dir_hash.name
        work_dir = wd_map.get(hash_name, f"未知路径 ({hash_name[:8]}…)")

        sessions = []
        for sess_dir in sorted(dir_hash.iterdir(), key=lambda d: d.stat().st_mtime, reverse=True):
            if not sess_dir.is_dir():
                continue

            meta = _read_session_meta(sess_dir)
            title = meta.get("custom_title") or meta.get("title") or "Untitled"

            # 检查是否有实际对话数据
            wire = sess_dir / "wire.jsonl"
            has_data = wire.exists() and wire.stat().st_size > 0

            sessions.append({
                "session_id": sess_dir.name,
                "title": title,
                "has_data": has_data,
                "archived": meta.get("archived", False),
                "mtime": sess_dir.stat().st_mtime,
            })

        if sessions:
            result.append({
                "work_dir": work_dir,
                "dir_hash": hash_name,
                "sessions": sessions,
            })

    return result


@router.get("/{dir_hash}/{session_id}/messages")
def get_kimi_session_messages(dir_hash: str, session_id: str):
    """读取指定 Kimi session 的对话消息。"""
    # 基本路径验证：只允许十六进制 hash 和 UUID 格式
    if not all(c in "0123456789abcdef" for c in dir_hash):
        raise HTTPException(400, "无效的目录 hash")
    if not all(c in "0123456789abcdef-" for c in session_id):
        raise HTTPException(400, "无效的 session ID")

    session_dir = SESSIONS_DIR / dir_hash / session_id
    if not session_dir.exists() or not session_dir.is_dir():
        raise HTTPException(404, "Session 不存在")

    # 确保路径不越界
    try:
        session_dir.resolve().relative_to(SESSIONS_DIR.resolve())
    except ValueError:
        raise HTTPException(400, "非法路径")

    wire_path = session_dir / "wire.jsonl"
    messages = _parse_wire_messages(wire_path)

    meta = _read_session_meta(session_dir)
    title = meta.get("custom_title") or meta.get("title") or "Untitled"

    # 从 kimi.json 中找出该 dir_hash 对应的工作目录
    wd_map = _get_work_dir_map()
    work_dir = wd_map.get(dir_hash)

    return {
        "session_id": session_id,
        "title": title,
        "work_dir": work_dir,
        "messages": messages,
    }


@router.get("/resolve/{session_id}")
def resolve_kimi_session(session_id: str):
    """通过 session UUID 在所有 dir_hash 目录下查找 Kimi 本地会话并返回消息。"""
    if not all(c in "0123456789abcdef-" for c in session_id):
        raise HTTPException(400, "无效的 session ID")

    if not SESSIONS_DIR.exists():
        raise HTTPException(404, "Kimi sessions 目录不存在")

    for dir_hash_dir in SESSIONS_DIR.iterdir():
        if not dir_hash_dir.is_dir():
            continue
        session_dir = dir_hash_dir / session_id
        if session_dir.is_dir():
            wire_path = session_dir / "wire.jsonl"
            if not wire_path.exists():
                continue
            messages = _parse_wire_messages(wire_path)
            meta = _read_session_meta(session_dir)
            title = meta.get("custom_title") or meta.get("title") or "Untitled"
            return {
                "session_id": session_id,
                "title": title,
                "messages": messages,
            }

    raise HTTPException(404, "未找到该 Kimi session")
