"""
POP3 邮件同步引擎。
POP3 协议不支持文件夹，所有邮件都在收件箱。
不支持服务端标记已读/移动/删除（标记只在本地生效）。
"""
from __future__ import annotations

import datetime as dt
import email
import email.header
import email.utils
import json
import logging
import poplib
import re
from typing import Any

from sqlalchemy.orm import Session

from models import Email, EmailAccount, EmailFolder
from services.email_crypto import decrypt_password
from services.email_sync import (
    _decode_header,
    _parse_address,
    _parse_address_list,
    _parse_date,
    _get_body,
    _get_attachments_meta,
    _make_snippet,
)

logger = logging.getLogger("email_pop3")

# POP3 每次最多拉取邮件数
MAX_POP3_EMAILS = 200


POP3_TIMEOUT = 20  # 秒，连接/登录超时


def _connect_pop3(account: EmailAccount) -> poplib.POP3_SSL | poplib.POP3:
    """建立 POP3 连接并登录。"""
    password = decrypt_password(account.encrypted_password)
    host = account.pop3_host or account.imap_host
    port = account.pop3_port or 995

    if account.use_ssl:
        conn = poplib.POP3_SSL(host, port, timeout=POP3_TIMEOUT)
    else:
        conn = poplib.POP3(host, port, timeout=POP3_TIMEOUT)
    conn.user(account.username)
    conn.pass_(password)
    return conn


def _ensure_inbox_folder(account: EmailAccount, db: Session) -> EmailFolder:
    """确保 inbox 文件夹存在。"""
    folder = db.query(EmailFolder).filter_by(
        account_id=account.id, folder_type="inbox"
    ).first()
    if not folder:
        folder = EmailFolder(
            account_id=account.id,
            name="收件箱",
            remote_name="INBOX",
            folder_type="inbox",
            sort_order=0,
        )
        db.add(folder)
        db.flush()
    return folder


def sync_pop3_emails(account: EmailAccount, db: Session) -> int:
    """
    拉取 POP3 邮件，基于 Message-ID 去重，返回新邮件数。
    POP3 只有收件箱，会自动创建。
    """
    folder = _ensure_inbox_folder(account, db)

    # 已有 message_id 集合（用于去重，避免重复拉取）
    existing_ids = {
        r[0] for r in db.query(Email.message_id).filter_by(
            account_id=account.id, folder_id=folder.id
        ).all() if r[0]
    }

    conn = _connect_pop3(account)
    try:
        resp, listing, octets = conn.list()
        msg_nums = [item.decode().split()[0] for item in listing]

        # 从最新邮件开始，最多取 MAX_POP3_EMAILS 封
        msg_nums = msg_nums[-MAX_POP3_EMAILS:]
        msg_nums = list(reversed(msg_nums))  # 最新的先处理

        new_count = 0
        for num in msg_nums:
            try:
                resp2, lines, octets2 = conn.retr(num)
                raw = b"\r\n".join(lines)
                msg = email.message_from_bytes(raw)

                message_id = msg.get("Message-ID", "").strip()
                if message_id and message_id in existing_ids:
                    continue  # 已存在，跳过

                from_name, from_addr = _parse_address(msg.get("From"))
                to_addrs = _parse_address_list(msg.get("To"))
                cc_addrs = _parse_address_list(msg.get("Cc"))
                subject = _decode_header(msg.get("Subject"))
                date = _parse_date(msg.get("Date"))
                in_reply_to = msg.get("In-Reply-To", "").strip() or None
                refs = msg.get("References", "").strip()

                text_body, html_body = _get_body(msg)
                attachments = _get_attachments_meta(msg)
                snippet = _make_snippet(text_body, html_body)

                email_record = Email(
                    account_id=account.id,
                    folder_id=folder.id,
                    message_id=message_id,
                    uid=None,  # POP3 无 UID
                    subject=subject,
                    from_addr=from_addr,
                    from_name=from_name,
                    to_addrs=json.dumps(to_addrs, ensure_ascii=False),
                    cc_addrs=json.dumps(cc_addrs, ensure_ascii=False),
                    date=date,
                    body_text=text_body,
                    body_html=html_body,
                    attachments_meta=json.dumps(attachments, ensure_ascii=False),
                    is_read=False,
                    in_reply_to=in_reply_to,
                    references_header=refs,
                    snippet=snippet,
                )
                db.add(email_record)
                if message_id:
                    existing_ids.add(message_id)
                new_count += 1

            except Exception:
                logger.exception("Failed to fetch POP3 message #%s", num)

        db.commit()

        # 更新计数
        total = db.query(Email).filter_by(account_id=account.id, folder_id=folder.id).count()
        unread = db.query(Email).filter_by(account_id=account.id, folder_id=folder.id, is_read=False).count()
        folder.total_count = total
        folder.unread_count = unread
        db.commit()

        return new_count

    finally:
        try:
            conn.quit()
        except Exception:
            pass


def sync_pop3_folders(account: EmailAccount, db: Session) -> list[EmailFolder]:
    """POP3 只有收件箱，确保它存在并返回。"""
    folder = _ensure_inbox_folder(account, db)
    db.commit()
    return [folder]


def test_pop3_connection(host: str, port: int, username: str, password: str, use_ssl: bool) -> str:
    """测试 POP3 连接，返回 'ok' 或错误信息。"""
    import socket
    try:
        if use_ssl:
            conn = poplib.POP3_SSL(host, port, timeout=POP3_TIMEOUT)
        else:
            conn = poplib.POP3(host, port, timeout=POP3_TIMEOUT)
        try:
            conn.user(username)
            conn.pass_(password)
        except poplib.error_proto as e:
            raw = str(e)
            if "AUTH" in raw.upper() or "password" in raw.lower() or "invalid" in raw.lower():
                return f"登录失败（用户名或密码错误）。若使用QQ/163等，请使用授权码：{raw}"
            return f"登录失败：{raw}"
        conn.quit()
        return "ok"
    except socket.timeout:
        return f"连接超时：请检查 {host}:{port} 是否可访问"
    except ConnectionRefusedError:
        return f"连接被拒绝：{host}:{port} 端口不可访问"
    except OSError as e:
        return f"网络错误：{e}"
    except Exception as e:
        return str(e) or type(e).__name__
