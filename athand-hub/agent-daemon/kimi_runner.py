"""
Kimi Code CLI 封装：通过 Print 模式非交互调用 Kimi Code，
流式解析 JSONL 输出，通过回调函数实时回传。
"""
from __future__ import annotations

import asyncio
import json
import logging
import shlex
from typing import Callable, Awaitable

logger = logging.getLogger("kimi_runner")


async def run_kimi_task(
    prompt: str,
    work_dir: str | None,
    mode: str,
    kimi_command: str,
    on_message: Callable[[dict], Awaitable[None]],
    active_processes: dict | None = None,
    task_id: int | None = None,
    session_id: str | None = None,
) -> tuple[int, str | None]:
    """
    启动 kimi --print 进程，流式读取 JSONL 输出。

    Returns:
        (进程退出码, session_id)
    """
    cmd = [kimi_command, "--print", "-p", prompt, "--output-format", "stream-json"]

    if work_dir:
        cmd.extend(["-w", work_dir])

    # 如果有 session_id，用 -r 恢复会话（实现持续对话）
    if session_id:
        cmd.extend(["-r", session_id])
    elif mode == "plan":
        cmd.append("--plan")
    elif mode == "continue":
        cmd.append("-C")

    logger.info("Starting kimi: %s", " ".join(shlex.quote(c) for c in cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=work_dir,
    )

    # 注册进程以支持取消
    if active_processes is not None and task_id is not None:
        active_processes[task_id] = proc

    # 逐行读取 stdout（JSONL 格式）
    assert proc.stdout is not None
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        line_str = line.decode("utf-8", errors="replace").strip()
        if not line_str:
            continue
        try:
            msg = json.loads(line_str)
            await on_message(msg)
        except json.JSONDecodeError:
            # 非 JSON 行（可能是 stderr 混入或其他输出）
            logger.debug("Non-JSON line: %s", line_str[:200])
            await on_message({"role": "system", "content": line_str})

    # 等待进程结束
    await proc.wait()
    exit_code = proc.returncode or 0

    # 读取 stderr，从中提取 session_id
    session_id = None
    if proc.stderr:
        stderr_data = await proc.stderr.read()
        if stderr_data:
            stderr_str = stderr_data.decode("utf-8", errors="replace").strip()
            if stderr_str:
                logger.info("Kimi stderr: %s", stderr_str[:500])
                # 提取 session_id: "To resume this session: kimi -r <uuid>"
                import re
                m = re.search(r'kimi -r ([0-9a-f-]{36})', stderr_str)
                if m:
                    session_id = m.group(1)
                    logger.info("Captured session_id: %s", session_id)

    logger.info("Kimi exited with code %d", exit_code)
    return exit_code, session_id
