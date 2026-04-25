"""
IMAP 邮件同步引擎。
- 同步文件夹列表
- 增量同步邮件（基于 UID）
- 标记已读、移动、删除
"""
from __future__ import annotations

import datetime as dt
import base64
import email
import email.header
import email.utils
import imaplib
import json
import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from models import Email, EmailAccount, EmailFolder
from services.email_crypto import decrypt_password

logger = logging.getLogger("email_sync")

# IMAP 文件夹名到 folder_type 的映射（常见名称）
_KNOWN_FOLDERS: dict[str, str] = {
    "INBOX": "inbox",
    "Sent": "sent", "Sent Messages": "sent", "Sent Items": "sent", "已发送": "sent",
    "INBOX.Sent": "sent", "[Gmail]/Sent Mail": "sent",
    "Drafts": "drafts", "草稿": "drafts", "INBOX.Drafts": "drafts",
    "Trash": "trash", "已删除": "trash", "Deleted Messages": "trash",
    "INBOX.Trash": "trash", "Deleted Items": "trash",
    "Junk": "spam", "Spam": "spam", "垃圾邮件": "spam", "INBOX.Junk": "spam",
    "Junk E-mail": "spam",
}

_FOLDER_SORT: dict[str, int] = {
    "inbox": 0, "sent": 1, "drafts": 2, "trash": 3, "spam": 4, "custom": 5,
}

# 每次增量同步最多拉取的邮件数
MAX_SYNC_EMAILS = 200


def _connect_imap(account: EmailAccount) -> imaplib.IMAP4_SSL | imaplib.IMAP4:
    """建立 IMAP 连接并登录。"""
    password = decrypt_password(account.encrypted_password)
    if account.use_ssl:
        conn = imaplib.IMAP4_SSL(account.imap_host, account.imap_port)
    else:
        conn = imaplib.IMAP4(account.imap_host, account.imap_port)
    conn.login(account.username, password)
    return conn


def _decode_header(raw: str | None) -> str:
    """解码 RFC 2047 编码的邮件头。"""
    if not raw:
        return ""
    parts = email.header.decode_header(raw)
    decoded = []
    for data, charset in parts:
        if isinstance(data, bytes):
            decoded.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(data)
    return " ".join(decoded).strip()


def _parse_address(raw: str | None) -> tuple[str, str]:
    """解析邮件地址，返回 (name, addr)。"""
    if not raw:
        return ("", "")
    name, addr = email.utils.parseaddr(raw)
    return (_decode_header(name), addr)


def _parse_address_list(raw: str | None) -> list[dict[str, str]]:
    """解析多个逗号分隔的邮件地址。"""
    if not raw:
        return []
    pairs = email.utils.getaddresses([raw])
    return [{"name": _decode_header(n), "addr": a} for n, a in pairs if a]


def _parse_date(raw: str | None) -> dt.datetime | None:
    """解析邮件日期。"""
    if not raw:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(raw)
        return parsed
    except Exception:
        return None


def _get_body(msg: email.message.Message) -> tuple[str, str]:
    """提取邮件正文，返回 (text, html)。内嵌 cid: 图片替换为 data: URI。"""
    text_body = ""
    html_body = ""
    cid_map: dict[str, str] = {}  # cid -> data URI

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            cid = part.get("Content-ID", "").strip().strip("<>")

            # 收集内嵌图片（inline 或带 Content-ID 的图片）
            if ct.startswith("image/") and cid:
                payload = part.get_payload(decode=True)
                if payload:
                    b64 = base64.b64encode(payload).decode()
                    cid_map[cid] = f"data:{ct};base64,{b64}"
                continue

            if "attachment" in cd:
                continue
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except (LookupError, UnicodeDecodeError):
                decoded = payload.decode("utf-8", errors="replace")
            if ct == "text/plain" and not text_body:
                text_body = decoded
            elif ct == "text/html" and not html_body:
                html_body = decoded
    else:
        ct = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except (LookupError, UnicodeDecodeError):
                decoded = payload.decode("utf-8", errors="replace")
            if ct == "text/html":
                html_body = decoded
            else:
                text_body = decoded

    # 将 cid: 引用替换为 data URI
    if cid_map and html_body:
        def _replace_cid(m: re.Match) -> str:
            cid_val = m.group(1).strip()
            return f'src="{cid_map.get(cid_val, m.group(0)[5:-1])}"'
        html_body = re.sub(r'src="cid:([^"]+)"', _replace_cid, html_body, flags=re.IGNORECASE)
        html_body = re.sub(r"src='cid:([^']+)'", lambda m: f"src='{cid_map.get(m.group(1).strip(), 'cid:' + m.group(1))}'", html_body, flags=re.IGNORECASE)

    return text_body, html_body


def _get_attachments_meta(msg: email.message.Message) -> list[dict]:
    """提取附件元数据（不下载本体）。"""
    attachments = []
    if not msg.is_multipart():
        return attachments
    for part in msg.walk():
        cd = str(part.get("Content-Disposition", ""))
        if "attachment" not in cd and "inline" not in cd:
            continue
        filename = part.get_filename()
        if filename:
            filename = _decode_header(filename)
        else:
            continue
        size = len(part.get_payload(decode=True) or b"")
        attachments.append({
            "filename": filename,
            "size": size,
            "content_type": part.get_content_type(),
        })
    return attachments


def _make_snippet(text: str, html: str, max_len: int = 200) -> str:
    """从正文生成简短摘要。"""
    source = text or html
    if not source:
        return ""
    # 去除 HTML 标签
    clean = re.sub(r"<[^>]+>", " ", source)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean[:max_len]


# ============================================================
# 公开 API
# ============================================================

def sync_folders(account: EmailAccount, db: Session) -> list[EmailFolder]:
    """同步邮箱文件夹列表，返回所有文件夹。"""
    conn = _connect_imap(account)
    try:
        status, folder_data = conn.list()
        if status != "OK":
            raise RuntimeError(f"IMAP LIST failed: {status}")

        remote_names: set[str] = set()
        for item in folder_data:
            if isinstance(item, bytes):
                # 格式: (\\Flags) "delimiter" "name"
                match = re.match(rb'\(([^)]*)\)\s+"([^"]+)"\s+"?([^"]*)"?', item)
                if not match:
                    # 尝试无引号格式
                    match = re.match(rb'\(([^)]*)\)\s+"([^"]+)"\s+(.*)', item)
                if match:
                    flags_raw = match.group(1).decode(errors="replace")
                    name_raw = match.group(3).decode(errors="replace").strip().strip('"')
                    # 跳过 \Noselect 文件夹
                    if "\\Noselect" in flags_raw:
                        continue
                    remote_names.add(name_raw)

        # 更新本地文件夹记录
        existing = {f.remote_name: f for f in db.query(EmailFolder).filter_by(account_id=account.id).all()}

        folders = []
        for rname in remote_names:
            folder_type = _KNOWN_FOLDERS.get(rname, "custom")
            sort_order = _FOLDER_SORT.get(folder_type, 5)
            display_name = rname.split(".")[-1] if "." in rname else rname

            if rname in existing:
                f = existing[rname]
                f.folder_type = folder_type
                f.sort_order = sort_order
                folders.append(f)
            else:
                f = EmailFolder(
                    account_id=account.id,
                    name=display_name,
                    remote_name=rname,
                    folder_type=folder_type,
                    sort_order=sort_order,
                )
                db.add(f)
                folders.append(f)

        # 删除远端不存在的本地文件夹
        for rname, f in existing.items():
            if rname not in remote_names:
                db.delete(f)

        db.commit()
        return folders

    finally:
        try:
            conn.logout()
        except Exception:
            pass


def sync_emails(account: EmailAccount, folder: EmailFolder, db: Session) -> int:
    """增量同步指定文件夹的邮件，返回新拉取的邮件数。"""
    conn = _connect_imap(account)
    try:
        # 选择文件夹
        status, data = conn.select(f'"{folder.remote_name}"', readonly=True)
        if status != "OK":
            logger.warning("Cannot select folder %s: %s", folder.remote_name, status)
            return 0

        # 获取现有最大 UID
        max_uid = db.query(Email.uid).filter_by(
            account_id=account.id, folder_id=folder.id
        ).order_by(Email.uid.desc()).first()
        max_uid_val = max_uid[0] if max_uid else 0

        # 搜索新邮件
        if max_uid_val:
            search_criteria = f"UID {max_uid_val + 1}:*"
        else:
            search_criteria = f"1:*"

        status, uid_data = conn.uid("search", None, search_criteria)
        if status != "OK":
            return 0

        uid_list = uid_data[0].split() if uid_data[0] else []

        # 过滤已有 UID
        if max_uid_val:
            uid_list = [u for u in uid_list if int(u) > max_uid_val]

        # 限制数量
        uid_list = uid_list[-MAX_SYNC_EMAILS:]

        if not uid_list:
            # 更新计数
            _update_folder_counts(account.id, folder, db)
            return 0

        new_count = 0
        for uid_bytes in uid_list:
            uid_val = int(uid_bytes)
            try:
                status, msg_data = conn.uid("fetch", uid_bytes, "(RFC822 FLAGS)")
                if status != "OK" or not msg_data or not msg_data[0]:
                    continue

                raw_email = None
                flags_str = ""
                for part in msg_data:
                    if isinstance(part, tuple) and len(part) == 2:
                        raw_email = part[1]
                        flags_str = part[0].decode(errors="replace")
                        break

                if raw_email is None:
                    continue

                msg = email.message_from_bytes(raw_email)

                # 解析字段
                from_name, from_addr = _parse_address(msg.get("From"))
                to_addrs = _parse_address_list(msg.get("To"))
                cc_addrs = _parse_address_list(msg.get("Cc"))
                subject = _decode_header(msg.get("Subject"))
                date = _parse_date(msg.get("Date"))
                message_id = msg.get("Message-ID", "").strip()
                in_reply_to = msg.get("In-Reply-To", "").strip() or None
                refs = msg.get("References", "").strip()

                text_body, html_body = _get_body(msg)
                attachments = _get_attachments_meta(msg)
                snippet = _make_snippet(text_body, html_body)

                is_read = "\\Seen" in flags_str

                email_record = Email(
                    account_id=account.id,
                    folder_id=folder.id,
                    message_id=message_id,
                    uid=uid_val,
                    subject=subject,
                    from_addr=from_addr,
                    from_name=from_name,
                    to_addrs=json.dumps(to_addrs, ensure_ascii=False),
                    cc_addrs=json.dumps(cc_addrs, ensure_ascii=False),
                    date=date,
                    body_text=text_body,
                    body_html=html_body,
                    attachments_meta=json.dumps(attachments, ensure_ascii=False),
                    is_read=is_read,
                    in_reply_to=in_reply_to,
                    references_header=refs,
                    snippet=snippet,
                )
                db.add(email_record)
                new_count += 1

            except Exception:
                logger.exception("Failed to fetch UID %s in folder %s", uid_val, folder.remote_name)

        db.commit()
        _update_folder_counts(account.id, folder, db)
        return new_count

    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _update_folder_counts(account_id: int, folder: EmailFolder, db: Session):
    """更新文件夹的邮件计数。"""
    total = db.query(Email).filter_by(account_id=account_id, folder_id=folder.id).count()
    unread = db.query(Email).filter_by(account_id=account_id, folder_id=folder.id, is_read=False).count()
    folder.total_count = total
    folder.unread_count = unread
    db.commit()


def mark_email_read(account: EmailAccount, email_record: Email, is_read: bool, db: Session):
    """在 IMAP 上标记邮件已读/未读。"""
    if email_record.uid is None:
        return
    folder = db.query(EmailFolder).get(email_record.folder_id)
    if not folder:
        return

    conn = _connect_imap(account)
    try:
        conn.select(f'"{folder.remote_name}"')
        flag = "+FLAGS" if is_read else "-FLAGS"
        conn.uid("store", str(email_record.uid).encode(), flag, "\\Seen")
        email_record.is_read = is_read
        db.commit()
        _update_folder_counts(account.id, folder, db)
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def move_email_imap(account: EmailAccount, email_record: Email,
                    target_folder: EmailFolder, db: Session):
    """在 IMAP 上移动邮件到目标文件夹。"""
    if email_record.uid is None:
        return
    src_folder = db.query(EmailFolder).get(email_record.folder_id)
    if not src_folder:
        return

    conn = _connect_imap(account)
    try:
        conn.select(f'"{src_folder.remote_name}"')
        conn.uid("copy", str(email_record.uid).encode(), f'"{target_folder.remote_name}"')
        conn.uid("store", str(email_record.uid).encode(), "+FLAGS", "\\Deleted")
        conn.expunge()

        # 更新本地记录
        old_folder_id = email_record.folder_id
        email_record.folder_id = target_folder.id
        email_record.uid = None  # UID 在新文件夹中会变，下次同步会更新
        db.commit()

        _update_folder_counts(account.id, src_folder, db)
        _update_folder_counts(account.id, target_folder, db)
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def delete_email_imap(account: EmailAccount, email_record: Email, db: Session):
    """在 IMAP 上删除邮件（标记 Deleted 并 expunge）。"""
    if email_record.uid is None:
        # 仅删除本地
        folder = db.query(EmailFolder).get(email_record.folder_id)
        db.delete(email_record)
        db.commit()
        if folder:
            _update_folder_counts(account.id, folder, db)
        return

    folder = db.query(EmailFolder).get(email_record.folder_id)
    if not folder:
        return

    conn = _connect_imap(account)
    try:
        conn.select(f'"{folder.remote_name}"')
        conn.uid("store", str(email_record.uid).encode(), "+FLAGS", "\\Deleted")
        conn.expunge()

        db.delete(email_record)
        db.commit()
        _update_folder_counts(account.id, folder, db)
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def test_imap_connection(host: str, port: int, username: str, password: str, use_ssl: bool) -> str:
    """测试 IMAP 连接，返回 'ok' 或错误信息。"""
    import socket
    try:
        if use_ssl:
            conn = imaplib.IMAP4_SSL(host, port)
        else:
            conn = imaplib.IMAP4(host, port)
        try:
            conn.login(username, password)
        except imaplib.IMAP4.error as e:
            raw = str(e)
            # 把 bytes 字面量转为可读字符串
            if raw.startswith("b'") or raw.startswith('b"'):
                raw = raw[2:-1]
            if "AUTHENTICATIONFAILED" in raw.upper() or "Invalid" in raw:
                return f"登录失败（用户名或密码错误）。若使用QQ/163等，请确认已开启IMAP服务并使用授权码而非登录密码：{raw}"
            return f"登录失败：{raw}"
        conn.logout()
        return "ok"
    except socket.timeout:
        return f"连接超时：请检查 {host}:{port} 是否可访问"
    except ConnectionRefusedError:
        return f"连接被拒紾：{host}:{port} 端口不可访问"
    except OSError as e:
        return f"网络错误：{e}"
    except Exception as e:
        raw = str(e)
        if raw.startswith("b'") or raw.startswith('b"'):
            raw = raw[2:-1]
        return raw or type(e).__name__
