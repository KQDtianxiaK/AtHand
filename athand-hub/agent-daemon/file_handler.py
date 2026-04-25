"""
文件操作处理器：list / read / write，带白名单目录限制。
"""
from __future__ import annotations

import os
from pathlib import Path


def _resolve_and_check(path_str: str, allowed_dirs: list[str]) -> Path:
    """解析路径并检查是否在允许的目录内。"""
    p = Path(path_str).expanduser().resolve()
    for d in allowed_dirs:
        allowed = Path(d).expanduser().resolve()
        try:
            p.relative_to(allowed)
            return p
        except ValueError:
            continue
    raise PermissionError(f"路径不在允许的目录内: {path_str}")


def file_list(path_str: str, allowed_dirs: list[str]) -> dict:
    p = _resolve_and_check(path_str, allowed_dirs)
    if not p.exists():
        return {"error": "路径不存在"}
    if not p.is_dir():
        return {"error": "不是目录"}
    entries = []
    for item in sorted(p.iterdir()):
        entries.append({
            "name": item.name,
            "is_dir": item.is_dir(),
            "size": item.stat().st_size if item.is_file() else 0,
        })
    return {"path": str(p), "entries": entries}


def file_read(path_str: str, allowed_dirs: list[str], max_size: int = 2 * 1024 * 1024) -> dict:
    p = _resolve_and_check(path_str, allowed_dirs)
    if not p.exists():
        return {"error": "文件不存在"}
    if not p.is_file():
        return {"error": "不是文件"}
    if p.stat().st_size > max_size:
        return {"error": f"文件过大 ({p.stat().st_size} bytes)"}
    try:
        content = p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return {"error": str(e)}
    return {"path": str(p), "content": content, "size": len(content)}


def file_write(path_str: str, content: str, allowed_dirs: list[str]) -> dict:
    p = _resolve_and_check(path_str, allowed_dirs)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return {"path": str(p), "size": len(content), "ok": True}
