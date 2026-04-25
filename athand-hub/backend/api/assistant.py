"""
AI 助手：SSE 流式对话 + 模型设置管理。
支持任意 OpenAI-compatible API（DeepSeek、Qwen、Kimi/Moonshot、GLM 等）。
"""
from __future__ import annotations

import asyncio
import datetime as dt
import inspect
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.auth import get_current_user
from api.assistant_tools import TOOL_FUNCTIONS, TOOL_SCHEMAS

logger = logging.getLogger("assistant")

router = APIRouter(
    prefix="/api/assistant",
    tags=["assistant"],
    dependencies=[Depends(get_current_user)],
)

# ============================================================
# 设置持久化（存为 JSON 文件）
# ============================================================

_SETTINGS_FILE = Path(__file__).resolve().parent.parent / "data" / "ai_settings.json"


def _load_ai_settings() -> dict:
    if _SETTINGS_FILE.exists():
        try:
            return json.loads(_SETTINGS_FILE.read_text("utf-8"))
        except Exception:
            pass
    return {"api_base": "", "api_key": "", "model": ""}


def _save_ai_settings(data: dict):
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


class AISettingsBody(BaseModel):
    api_base: str = ""
    api_key: str = ""
    model: str = ""


@router.get("/settings")
def get_settings():
    s = _load_ai_settings()
    # 对 key 做脱敏
    key = s.get("api_key", "")
    masked = (key[:8] + "***" + key[-4:]) if len(key) > 12 else ("***" if key else "")
    return {
        "api_base": s.get("api_base", ""),
        "api_key_masked": masked,
        "api_key_set": bool(key),
        "model": s.get("model", ""),
    }


@router.put("/settings")
def update_settings(body: AISettingsBody):
    current = _load_ai_settings()
    if body.api_base:
        current["api_base"] = body.api_base.rstrip("/")
    if body.api_key:
        current["api_key"] = body.api_key
    if body.model:
        current["model"] = body.model
    _save_ai_settings(current)
    return {"ok": True}


# ============================================================
# 对话历史（内存存储，TTL 30 分钟）
# ============================================================

_conversations: dict[str, dict] = {}  # conv_id → {messages, last_access}
_CONV_TTL = 1800  # 30 分钟
_MAX_HISTORY = 30  # 最多保留消息条数


def _get_conversation(conv_id: str) -> list[dict]:
    _cleanup_conversations()
    entry = _conversations.get(conv_id)
    if entry:
        entry["last_access"] = time.time()
        return entry["messages"]
    msgs: list[dict] = []
    _conversations[conv_id] = {"messages": msgs, "last_access": time.time()}
    return msgs


def _cleanup_conversations():
    now = time.time()
    expired = [k for k, v in _conversations.items() if now - v["last_access"] > _CONV_TTL]
    for k in expired:
        del _conversations[k]


# ============================================================
# SSE 对话端点
# ============================================================

SYSTEM_PROMPT = """你是 AtHand 智能助手，一个全能的个人效率助手。你可以帮用户：
- 管理待办事项（创建、查看、完成）
- 上下班打卡（上午/下午/晚上三个时段）
- 管理备忘录（创建、搜索）
- 派发编程任务到远程机器上的 Kimi Code
- 抓取网页 URL 并根据指示提取信息
- 查看工作统计数据
- 管理邮箱：搜索邮件、查看/总结邮件内容、起草回复、发送邮件、查看文件夹、移动邮件

当前时间：{now}

回复规则：
- 用中文回答
- 简洁直接，不要啰嗦
- 如果需要操作系统（创建待办、打卡等），直接调用工具执行，执行完后简要报告结果
- 用户说"打卡"但没指定时段时，根据当前时间自动判断（6-12点=morning，12-18点=afternoon，18点后=evening）
- 不要重复用户的话
- 邮件相关：搜索邮件时先调用 search_emails，分析/总结邮件调用 summarize_email 获取全文，回复邮件先 draft_reply 获取信息再 send_email_tool 发送
- 重要：发送邮件时必须调用 send_email_tool 工具，绝对不能凭空声称已发送——系统会在界面展示确认卡片，用户点击确认后邮件才会真正发出，调用工具后不要再输出任何有关邮件是否已发送的文字
- 多收件人：给多个人发邮件时，必须把所有收件人地址用英文逗号拼在一起，在**一次** send_email_tool 调用中全部填入 to_addrs，绝对不能分多次调用分别发送
"""


class ChatBody(BaseModel):
    message: str
    conversation_id: str | None = None


@router.post("/chat")
async def chat(body: ChatBody, request: Request):
    settings = _load_ai_settings()
    if not settings.get("api_key") or not settings.get("api_base") or not settings.get("model"):
        raise HTTPException(400, "请先配置 AI 模型设置（API 地址、Key、模型名称）")

    conv_id = body.conversation_id or str(uuid.uuid4())
    messages = _get_conversation(conv_id)

    # 首次对话添加 system prompt
    if not messages:
        now_str = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S %A")
        messages.append({"role": "system", "content": SYSTEM_PROMPT.format(now=now_str)})

    # 添加用户消息
    messages.append({"role": "user", "content": body.message})

    # 截断历史（保留 system + 最近 N 条）
    if len(messages) > _MAX_HISTORY + 1:
        messages[:] = [messages[0]] + messages[-((_MAX_HISTORY)):]

    async def event_stream():
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=settings["api_key"],
            base_url=settings["api_base"],
        )

        # SSE 头：先发 conversation_id
        yield _sse({"type": "meta", "conversation_id": conv_id})

        try:
            # function calling 循环（最多 8 轮防死循环）
            for _ in range(8):
                # 流式调用
                full_content = ""
                tool_calls_acc: dict[int, dict] = {}  # index → {id, name, arguments}

                stream = await client.chat.completions.create(
                    model=settings["model"],
                    messages=messages,
                    tools=TOOL_SCHEMAS,
                    stream=True,
                )

                async for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if not delta:
                        continue

                    # 文本内容
                    if delta.content:
                        full_content += delta.content
                        yield _sse({"type": "text", "content": delta.content})

                    # tool_calls 累积
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in tool_calls_acc:
                                tool_calls_acc[idx] = {
                                    "id": tc.id or "",
                                    "name": tc.function.name if tc.function and tc.function.name else "",
                                    "arguments": "",
                                }
                            if tc.id:
                                tool_calls_acc[idx]["id"] = tc.id
                            if tc.function:
                                if tc.function.name:
                                    tool_calls_acc[idx]["name"] = tc.function.name
                                if tc.function.arguments:
                                    tool_calls_acc[idx]["arguments"] += tc.function.arguments

                finish_reason = chunk.choices[0].finish_reason if chunk.choices else None

                # 如果有 tool_calls → 执行
                if tool_calls_acc:
                    # 构建 assistant message
                    tc_list = [
                        {
                            "id": v["id"],
                            "type": "function",
                            "function": {"name": v["name"], "arguments": v["arguments"]},
                        }
                        for v in sorted(tool_calls_acc.values(), key=lambda x: x["id"])
                    ]
                    assistant_msg: dict[str, Any] = {"role": "assistant", "tool_calls": tc_list}
                    if full_content:
                        assistant_msg["content"] = full_content
                    messages.append(assistant_msg)

                    # 执行每个 tool
                    email_intercepted = False
                    for tc in tc_list:
                        fn_name = tc["function"]["name"]
                        fn_args_str = tc["function"]["arguments"]
                        yield _sse({"type": "tool_call", "name": fn_name, "arguments": fn_args_str})

                        try:
                            fn_args = json.loads(fn_args_str) if fn_args_str else {}
                        except json.JSONDecodeError:
                            fn_args = {}

                        if fn_name == "send_email_tool":
                            # 拦截：不立即发送，前端展示确认卡片后由前端直接调用发送接口
                            yield _sse({"type": "email_confirm_required", "name": fn_name, "arguments": fn_args_str})
                            # 记录到对话历史（保证 tool_call_id 配对），但不再进行下一轮 LLM 调用
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tc["id"],
                                "content": json.dumps({"status": "pending_confirmation"}, ensure_ascii=False),
                            })
                            email_intercepted = True
                            break  # 不处理后续其他工具调用
                        else:
                            fn = TOOL_FUNCTIONS.get(fn_name)
                            if fn:
                                try:
                                    result = fn(**fn_args)
                                    # 处理 async 函数
                                    if inspect.isawaitable(result):
                                        result = await result
                                except Exception as e:
                                    result = json.dumps({"error": str(e)}, ensure_ascii=False)
                            else:
                                result = json.dumps({"error": f"未知工具: {fn_name}"}, ensure_ascii=False)
                            yield _sse({"type": "tool_result", "name": fn_name, "result": result})
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tc["id"],
                                "content": result,
                            })

                    if email_intercepted:
                        # 邮件已拦截给前端确认，直接结束本次 SSE 流，不再调用 LLM
                        yield _sse({"type": "done", "conversation_id": conv_id})
                        break

                    # 继续循环，让 LLM 处理 tool 结果
                    continue

                # 无 tool_calls，纯文本回复 → 结束
                if full_content:
                    messages.append({"role": "assistant", "content": full_content})
                yield _sse({"type": "done", "conversation_id": conv_id})
                break

        except Exception as e:
            logger.exception("AI chat error")
            yield _sse({"type": "error", "message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/clear")
def clear_conversation(body: dict):
    conv_id = body.get("conversation_id")
    if conv_id and conv_id in _conversations:
        del _conversations[conv_id]
    return {"ok": True}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
