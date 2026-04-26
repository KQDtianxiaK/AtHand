"""
AI 助手的 Tool 函数定义。
每个 tool 直接操作 DB，返回 JSON 字符串给 LLM。
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import ipaddress
import logging
import re
import urllib.request
import urllib.error
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from database import SessionLocal
from models import ClockRecord, Email, EmailAccount, EmailFolder, Memo, Todo, TodoList

logger = logging.getLogger("assistant_tools")


# ============================================================
# OpenAI-compatible function schemas
# ============================================================

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "create_todo",
            "description": "创建一个待办事项",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "待办标题"},
                    "due_date": {"type": "string", "description": "截止日期 YYYY-MM-DD（可选）"},
                    "priority": {"type": "integer", "description": "优先级 0=紧急 1=高 2=中 3=低（默认2）"},
                    "list_name": {"type": "string", "description": "所属列表名称（可选）"},
                    "description": {"type": "string", "description": "详细描述（可选）"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_todos",
            "description": "查询待办事项列表",
            "parameters": {
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "enum": ["today", "important", "all", "undone"],
                        "description": "过滤条件：today=今日、important=重要、all=全部、undone=未完成（默认undone）",
                    },
                    "limit": {"type": "integer", "description": "最多返回条数（默认10）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_todo",
            "description": "将一个待办标记为已完成。可传 id 或 title 关键词模糊匹配",
            "parameters": {
                "type": "object",
                "properties": {
                    "todo_id": {"type": "integer", "description": "待办 ID"},
                    "title_keyword": {"type": "string", "description": "标题关键词（模糊匹配）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clock_in",
            "description": "上班打卡",
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["morning", "afternoon", "evening"],
                        "description": "时段：morning=上午、afternoon=下午、evening=晚上",
                    },
                },
                "required": ["period"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clock_out",
            "description": "下班打卡",
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "string",
                        "enum": ["morning", "afternoon", "evening"],
                        "description": "时段",
                    },
                },
                "required": ["period"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_clock_status",
            "description": "获取当前打卡状态（哪些时段正在进行中）",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_memo",
            "description": "创建一条备忘录/笔记",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "标题"},
                    "content": {"type": "string", "description": "内容（支持 Markdown）"},
                    "tags": {"type": "string", "description": "标签，逗号分隔（可选）"},
                },
                "required": ["title", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_memos",
            "description": "搜索备忘录",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_memo",
            "description": "删除一条备忘录。可传 id 或 title 关键词模糊匹配",
            "parameters": {
                "type": "object",
                "properties": {
                    "memo_id": {"type": "integer", "description": "备忘录 ID"},
                    "title_keyword": {"type": "string", "description": "标题关键词（模糊匹配）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_kimi_task",
            "description": "给指定机器上的 Kimi Code 发送编程任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "任务提示词"},
                    "machine_id": {"type": "string", "description": "机器 ID（可选，不填则选第一台在线机器）"},
                    "work_dir": {"type": "string", "description": "工作目录（必填，bridge 创建会话需要）"},
                },
                "required": ["prompt", "work_dir"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_machines",
            "description": "列出所有已注册机器及在线状态",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "抓取一个网页 URL 的内容（返回纯文本），然后你可以根据用户要求分析内容并存备忘录",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要抓取的 URL"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stats",
            "description": "获取仪表盘统计数据（任务数、工时等）",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_emails",
            "description": "搜索邮件，支持按关键词、发件人、文件夹等筛选",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词（匹配主题、发件人、摘要）"},
                    "account_id": {"type": "integer", "description": "邮箱账号 ID（可选，不指定搜索所有账号）"},
                    "folder_type": {"type": "string", "description": "文件夹类型：inbox/sent/drafts/trash（可选）"},
                    "limit": {"type": "integer", "description": "返回数量，默认10"},
                },
                "required": ["keyword"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_email",
            "description": "获取指定邮件的完整内容（用于后续总结）",
            "parameters": {
                "type": "object",
                "properties": {
                    "email_id": {"type": "integer", "description": "邮件 ID"},
                },
                "required": ["email_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draft_reply",
            "description": "获取邮件信息以便起草回复（返回发件人、主题、原文等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "email_id": {"type": "integer", "description": "要回复的邮件 ID"},
                },
                "required": ["email_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_email_tool",
            "description": "发送邮件",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "integer", "description": "发件邮箱账号 ID"},
                    "to_addrs": {"type": "string", "description": "收件人邮箱地址；多个收件人必须用英文逗号拼成一个字符串，如 a@x.com,b@y.com，绝对不能分开多次调用"},
                    "subject": {"type": "string", "description": "邮件主题"},
                    "body": {"type": "string", "description": "邮件正文"},
                    "in_reply_to": {"type": "string", "description": "回复的邮件 Message-ID（可选）"},
                },
                "required": ["account_id", "to_addrs", "subject", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_email_folders",
            "description": "列出邮箱账号的文件夹列表及未读数",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "integer", "description": "邮箱账号 ID（可选，不指定列出所有账号）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_email_tool",
            "description": "移动邮件到指定文件夹（如移到垃圾箱、归档等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "email_id": {"type": "integer", "description": "邮件 ID"},
                    "target_folder_type": {"type": "string", "description": "目标文件夹类型：inbox/sent/drafts/trash/spam"},
                },
                "required": ["email_id", "target_folder_type"],
            },
        },
    },
]


# ============================================================
# Tool 实现函数
# ============================================================

def _ok(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


def create_todo(title: str, due_date: str | None = None, priority: int = 2,
                list_name: str | None = None, description: str = "") -> str:
    db: Session = SessionLocal()
    try:
        list_id = None
        if list_name:
            tl = db.query(TodoList).filter(TodoList.name == list_name).first()
            if not tl:
                tl = TodoList(name=list_name)
                db.add(tl)
                db.flush()
            list_id = tl.id

        todo = Todo(
            title=title,
            description=description,
            priority=priority,
            due_date=dt.datetime.strptime(due_date, "%Y-%m-%d") if due_date else None,
            list_id=list_id,
        )
        db.add(todo)
        db.commit()
        db.refresh(todo)
        return _ok({"ok": True, "id": todo.id, "title": todo.title})
    finally:
        db.close()


def list_todos(filter: str = "undone", limit: int = 10) -> str:
    db: Session = SessionLocal()
    try:
        q = db.query(Todo)
        if filter == "today":
            today = dt.date.today()
            q = q.filter(Todo.my_day_date == today)
        elif filter == "important":
            q = q.filter(Todo.is_important.is_(True), Todo.is_done.is_(False))
        elif filter == "undone":
            q = q.filter(Todo.is_done.is_(False))
        # "all" → no filter

        todos = q.order_by(Todo.priority, Todo.created_at.desc()).limit(limit).all()
        return _ok([
            {"id": t.id, "title": t.title, "priority": t.priority,
             "due_date": str(t.due_date.date()) if t.due_date else None,
             "is_done": t.is_done, "is_important": t.is_important}
            for t in todos
        ])
    finally:
        db.close()


def complete_todo(todo_id: int | None = None, title_keyword: str | None = None) -> str:
    db: Session = SessionLocal()
    try:
        todo = None
        if todo_id:
            todo = db.query(Todo).filter(Todo.id == todo_id).first()
        elif title_keyword:
            todo = db.query(Todo).filter(
                Todo.title.contains(title_keyword), Todo.is_done.is_(False)
            ).first()

        if not todo:
            return _ok({"ok": False, "error": "未找到匹配的待办"})

        todo.is_done = True
        todo.done_at = dt.datetime.now(dt.timezone.utc)
        db.commit()
        return _ok({"ok": True, "id": todo.id, "title": todo.title})
    finally:
        db.close()


def clock_in(period: str) -> str:
    db: Session = SessionLocal()
    try:
        active = db.query(ClockRecord).filter(
            ClockRecord.clock_out.is_(None), ClockRecord.period == period
        ).first()
        if active:
            return _ok({"ok": False, "error": f"{period} 时段已在打卡中"})

        record = ClockRecord(
            clock_in=dt.datetime.now(dt.timezone.utc),
            period=period,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return _ok({"ok": True, "id": record.id, "period": period, "clock_in": str(record.clock_in)})
    finally:
        db.close()


def clock_out(period: str) -> str:
    db: Session = SessionLocal()
    try:
        active = db.query(ClockRecord).filter(
            ClockRecord.clock_out.is_(None), ClockRecord.period == period
        ).first()
        if not active:
            return _ok({"ok": False, "error": f"{period} 时段没有进行中的打卡"})

        active.clock_out = dt.datetime.now(dt.timezone.utc)
        db.commit()
        db.refresh(active)
        diff = (active.clock_out - active.clock_in).total_seconds() / 3600
        return _ok({"ok": True, "period": period, "hours": round(diff, 2)})
    finally:
        db.close()


def get_clock_status() -> str:
    db: Session = SessionLocal()
    try:
        actives = db.query(ClockRecord).filter(ClockRecord.clock_out.is_(None)).all()
        return _ok([
            {"period": r.period, "clock_in": str(r.clock_in)}
            for r in actives
        ])
    finally:
        db.close()


def create_memo(title: str, content: str, tags: str = "") -> str:
    db: Session = SessionLocal()
    try:
        memo = Memo(title=title, content=content, tags=tags)
        db.add(memo)
        db.commit()
        db.refresh(memo)
        return _ok({"ok": True, "id": memo.id, "title": memo.title})
    finally:
        db.close()


def search_memos(query: str) -> str:
    db: Session = SessionLocal()
    try:
        memos = db.query(Memo).filter(
            Memo.is_archived.is_(False),
            (Memo.title.contains(query) | Memo.content.contains(query))
        ).limit(10).all()
        return _ok([
            {"id": m.id, "title": m.title, "content": m.content[:200], "tags": m.tags}
            for m in memos
        ])
    finally:
        db.close()


def delete_memo(memo_id: int | None = None, title_keyword: str | None = None) -> str:
    db: Session = SessionLocal()
    try:
        memo = None
        if memo_id:
            memo = db.query(Memo).filter(Memo.id == memo_id).first()
        elif title_keyword:
            memo = db.query(Memo).filter(
                Memo.title.contains(title_keyword)
            ).first()

        if not memo:
            return _ok({"ok": False, "error": "未找到匹配的备忘录"})

        title = memo.title
        db.delete(memo)
        db.commit()
        return _ok({"ok": True, "id": memo_id or memo.id, "title": title})
    finally:
        db.close()


async def send_kimi_task(prompt: str, machine_id: str | None = None,
                         work_dir: str | None = None) -> str:
    from fastapi import HTTPException

    from api.ai_control_schemas import AiControlCreateSessionBody
    from services.ai_control_bridge import bridge_service

    resolved_work_dir = (work_dir or "").strip()
    if not resolved_work_dir:
        return _ok({"ok": False, "error": "请提供 work_dir"})

    def create_session_sync() -> dict[str, object]:
        db: Session = SessionLocal()
        try:
            resolved_machine_id = machine_id
            if not resolved_machine_id:
                machines = bridge_service.list_machines(db)
                machine = next((item for item in machines if item.daemon_reachable), None)
                if not machine:
                    machine = next((item for item in machines if item.is_online), None)
                if not machine:
                    return {"ok": False, "error": "没有可用的 paseo 机器"}
                resolved_machine_id = machine.id

            session = bridge_service.create_session(
                AiControlCreateSessionBody(
                    machine_id=resolved_machine_id,
                    provider="kimi",
                    cwd=resolved_work_dir,
                    initial_prompt=prompt,
                ),
                db,
            )
            return {
                "ok": True,
                "agent_id": session.agent_id,
                "machine_id": session.machine_id,
                "provider": session.provider,
                "cwd": session.cwd,
                "status": session.status,
            }
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            return {"ok": False, "error": detail}
        except Exception as exc:
            logger.exception("send_kimi_task failed")
            return {"ok": False, "error": f"创建 Kimi 会话失败: {exc}"}
        finally:
            db.close()

    return _ok(await asyncio.to_thread(create_session_sync))


def list_machines() -> str:
    from services.ai_control_bridge import bridge_service

    db: Session = SessionLocal()
    try:
        machines = bridge_service.list_machines(db)
        return _ok([
            {
                "id": m.id,
                "name": m.name,
                "is_online": m.is_online,
                "machine_type": m.machine_type,
                "daemon_reachable": m.daemon_reachable,
                "runtime_kind": m.runtime_kind,
            }
            for m in machines
        ])
    finally:
        db.close()


def _is_safe_url(url: str) -> bool:
    """检查 URL 是否安全（防 SSRF）。"""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname or ""
        if hostname in ("localhost", ""):
            return False
        try:
            addr = ipaddress.ip_address(hostname)
            if addr.is_private or addr.is_loopback or addr.is_reserved:
                return False
        except ValueError:
            # hostname 不是 IP，检查是否是 localhost 变体
            if hostname.endswith(".local") or hostname.endswith(".internal"):
                return False
        return True
    except Exception:
        return False


class _TextExtractor(HTMLParser):
    """简单 HTML → 纯文本提取器。"""
    def __init__(self):
        super().__init__()
        self._texts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: list):
        if tag in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag: str):
        if tag in ("script", "style", "noscript"):
            self._skip = False

    def handle_data(self, data: str):
        if not self._skip:
            text = data.strip()
            if text:
                self._texts.append(text)

    def get_text(self) -> str:
        return "\n".join(self._texts)


def fetch_url(url: str) -> str:
    if not _is_safe_url(url):
        return _ok({"ok": False, "error": "不允许访问内网或非 HTTP(S) 地址"})

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (AtHand Assistant)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read(200_000)  # 最多 200KB
            encoding = "utf-8"
            m = re.search(r"charset=([^\s;]+)", content_type)
            if m:
                encoding = m.group(1)
            text = raw.decode(encoding, errors="replace")

            if "html" in content_type.lower():
                extractor = _TextExtractor()
                extractor.feed(text)
                text = extractor.get_text()

            # 截断过长内容
            if len(text) > 8000:
                text = text[:8000] + "\n...(内容已截断)"

            return _ok({"ok": True, "url": url, "content": text})
    except urllib.error.URLError as e:
        return _ok({"ok": False, "error": f"抓取失败: {e.reason}"})
    except Exception as e:
        return _ok({"ok": False, "error": f"抓取失败: {e}"})


def get_stats() -> str:
    from api.stats import build_stats_overview

    db: Session = SessionLocal()
    try:
        overview = build_stats_overview(days=7, db=db)
        todo_total = db.query(Todo).count()
        todo_done = db.query(Todo).filter(Todo.is_done.is_(True)).count()

        today_hours = 0.0
        if overview["daily_work_hours"]:
            today_hours = float(overview["daily_work_hours"][-1]["total"])

        return _ok({
            "sessions": {
                "total": overview["total_sessions"],
                "done": overview["done_sessions"],
                "failed": overview["failed_sessions"],
            },
            "tasks": {
                "total": overview["total_sessions"],
                "done": overview["done_sessions"],
                "failed": overview["failed_sessions"],
            },
            "todos": {"total": todo_total, "done": todo_done, "undone": todo_total - todo_done},
            "today_work_hours": round(today_hours, 2),
        })
    finally:
        db.close()


# ============================================================
# Email Tool 实现函数
# ============================================================

def search_emails(keyword: str, account_id: int | None = None,
                  folder_type: str | None = None, limit: int = 10) -> str:
    db: Session = SessionLocal()
    try:
        q = db.query(Email)
        if account_id:
            q = q.filter(Email.account_id == account_id)
        if folder_type:
            folder_ids = [f.id for f in db.query(EmailFolder).filter(EmailFolder.folder_type == folder_type).all()]
            if folder_ids:
                q = q.filter(Email.folder_id.in_(folder_ids))
        like = f"%{keyword}%"
        q = q.filter(
            (Email.subject.ilike(like))
            | (Email.from_addr.ilike(like))
            | (Email.from_name.ilike(like))
            | (Email.snippet.ilike(like))
        )
        emails = q.order_by(Email.date.desc()).limit(limit).all()
        results = []
        for e in emails:
            results.append({
                "id": e.id, "subject": e.subject, "from": f"{e.from_name} <{e.from_addr}>",
                "date": str(e.date) if e.date else None, "snippet": e.snippet,
                "is_read": e.is_read, "folder_id": e.folder_id,
            })
        return _ok({"count": len(results), "emails": results})
    finally:
        db.close()


def summarize_email(email_id: int) -> str:
    db: Session = SessionLocal()
    try:
        e = db.query(Email).get(email_id)
        if not e:
            return _ok({"error": "邮件不存在"})
        return _ok({
            "id": e.id, "subject": e.subject,
            "from": f"{e.from_name} <{e.from_addr}>",
            "to": e.to_addrs, "cc": e.cc_addrs,
            "date": str(e.date) if e.date else None,
            "body_text": e.body_text[:3000] if e.body_text else "",
            "attachments": e.attachments_meta,
        })
    finally:
        db.close()


def draft_reply(email_id: int) -> str:
    db: Session = SessionLocal()
    try:
        e = db.query(Email).get(email_id)
        if not e:
            return _ok({"error": "邮件不存在"})
        return _ok({
            "email_id": e.id,
            "account_id": e.account_id,
            "reply_to_addr": e.from_addr,
            "reply_to_name": e.from_name,
            "subject": e.subject,
            "message_id": e.message_id,
            "original_body": e.body_text[:2000] if e.body_text else "",
        })
    finally:
        db.close()


def send_email_tool(account_id: int, to_addrs: str, subject: str, body: str,
                    in_reply_to: str | None = None) -> str:
    db: Session = SessionLocal()
    try:
        account = db.query(EmailAccount).get(account_id)
        if not account:
            return _ok({"error": "邮箱账号不存在"})

        from services.email_sender import send_email
        to_list = [a.strip() for a in to_addrs.split(",") if a.strip()]
        message_id = send_email(
            account=account, to_addrs=to_list, subject=subject,
            body_text=body, in_reply_to=in_reply_to, db=db,
        )
        # 自动归档联系人
        from api.email import _upsert_contacts
        _upsert_contacts(db, to_list)
        return _ok({"ok": True, "message_id": message_id})
    except Exception as e:
        return _ok({"error": f"发送失败: {e}"})
    finally:
        db.close()


def list_email_folders(account_id: int | None = None) -> str:
    db: Session = SessionLocal()
    try:
        if account_id:
            accounts = [db.query(EmailAccount).get(account_id)]
        else:
            accounts = db.query(EmailAccount).filter(EmailAccount.is_active.is_(True)).all()

        result = []
        for acc in accounts:
            if not acc:
                continue
            folders = db.query(EmailFolder).filter_by(account_id=acc.id).order_by(EmailFolder.sort_order).all()
            result.append({
                "account_id": acc.id, "email": acc.email,
                "folders": [
                    {"id": f.id, "name": f.name, "type": f.folder_type,
                     "unread": f.unread_count, "total": f.total_count}
                    for f in folders
                ],
            })
        return _ok(result)
    finally:
        db.close()


def move_email_tool(email_id: int, target_folder_type: str) -> str:
    db: Session = SessionLocal()
    try:
        e = db.query(Email).get(email_id)
        if not e:
            return _ok({"error": "邮件不存在"})
        account = db.query(EmailAccount).get(e.account_id)
        if not account:
            return _ok({"error": "账号不存在"})
        target = db.query(EmailFolder).filter_by(
            account_id=e.account_id, folder_type=target_folder_type
        ).first()
        if not target:
            return _ok({"error": f"找不到 {target_folder_type} 文件夹"})

        from services.email_sync import move_email_imap
        move_email_imap(account, e, target, db)
        return _ok({"ok": True})
    except Exception as ex:
        return _ok({"error": str(ex)})
    finally:
        db.close()


# ============================================================
# Tool 调度映射
# ============================================================

TOOL_FUNCTIONS: dict[str, Any] = {
    "create_todo": create_todo,
    "list_todos": list_todos,
    "complete_todo": complete_todo,
    "clock_in": clock_in,
    "clock_out": clock_out,
    "get_clock_status": get_clock_status,
    "create_memo": create_memo,
    "search_memos": search_memos,
    "delete_memo": delete_memo,
    "send_kimi_task": send_kimi_task,
    "list_machines": list_machines,
    "fetch_url": fetch_url,
    "get_stats": get_stats,
    "search_emails": search_emails,
    "summarize_email": summarize_email,
    "draft_reply": draft_reply,
    "send_email_tool": send_email_tool,
    "list_email_folders": list_email_folders,
    "move_email_tool": move_email_tool,
}
