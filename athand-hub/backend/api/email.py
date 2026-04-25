"""
邮箱管理 API 路由。
- 账号 CRUD、测试连接
- 同步文件夹和邮件
- 邮件列表/详情/已读/移动/删除
- 发送邮件、保存草稿
"""
from __future__ import annotations

import datetime as dt
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import Email, EmailAccount, EmailFolder, EmailContact
from services.email_crypto import encrypt_password, decrypt_password
from services.email_sender import send_email, test_smtp_connection
from services.email_sync import (
    delete_email_imap,
    mark_email_read,
    move_email_imap,
    sync_emails,
    sync_folders,
    test_imap_connection,
)
from services.email_pop3 import (
    sync_pop3_emails,
    sync_pop3_folders,
    test_pop3_connection,
)

router = APIRouter(prefix="/api/email", tags=["email"], dependencies=[Depends(get_current_user)])

_executor = ThreadPoolExecutor(max_workers=2)


# ============================================================
# Pydantic schemas
# ============================================================

class AccountCreate(BaseModel):
    email: str
    display_name: str = ""
    protocol: str = "imap"  # "imap" | "pop3"
    imap_host: str = ""
    imap_port: int = 993
    pop3_host: str = ""
    pop3_port: int = 995
    smtp_host: str
    smtp_port: int = 465
    username: str
    password: str
    use_ssl: bool = True
    sync_interval_minutes: int = 5


class AccountUpdate(BaseModel):
    display_name: str | None = None
    protocol: str | None = None
    imap_host: str | None = None
    imap_port: int | None = None
    pop3_host: str | None = None
    pop3_port: int | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    username: str | None = None
    password: str | None = None
    use_ssl: bool | None = None
    sync_interval_minutes: int | None = None
    is_active: bool | None = None


class AccountOut(BaseModel):
    id: int
    email: str
    display_name: str
    protocol: str
    imap_host: str
    imap_port: int
    pop3_host: str
    pop3_port: int
    smtp_host: str
    smtp_port: int
    username: str
    use_ssl: bool
    sync_interval_minutes: int
    last_sync_at: dt.datetime | None
    is_active: bool
    created_at: dt.datetime

    model_config = {"from_attributes": True}


class FolderOut(BaseModel):
    id: int
    account_id: int
    name: str
    remote_name: str
    folder_type: str
    unread_count: int
    total_count: int
    sort_order: int
    is_muted: bool

    model_config = {"from_attributes": True}


class EmailBrief(BaseModel):
    id: int
    account_id: int
    folder_id: int
    subject: str
    from_addr: str
    from_name: str
    date: dt.datetime | None
    snippet: str
    is_read: bool
    is_starred: bool
    has_attachments: bool

    model_config = {"from_attributes": True}


class EmailDetail(BaseModel):
    id: int
    account_id: int
    folder_id: int
    message_id: str
    subject: str
    from_addr: str
    from_name: str
    to_addrs: Any
    cc_addrs: Any
    bcc_addrs: Any
    date: dt.datetime | None
    body_text: str
    body_html: str
    attachments_meta: Any
    is_read: bool
    is_starred: bool
    is_draft: bool
    in_reply_to: str | None
    references_header: str | None
    created_at: dt.datetime

    model_config = {"from_attributes": True}


class SendEmailRequest(BaseModel):
    account_id: int
    to_addrs: list[str]
    subject: str
    body_text: str
    body_html: str | None = None
    cc_addrs: list[str] | None = None
    bcc_addrs: list[str] | None = None
    in_reply_to: str | None = None
    references: str | None = None


class TestConnectionRequest(BaseModel):
    protocol: str = "imap"  # "imap" | "pop3"
    imap_host: str = ""
    imap_port: int = 993
    pop3_host: str = ""
    pop3_port: int = 995
    smtp_host: str
    smtp_port: int = 465
    username: str
    password: str
    use_ssl: bool = True


class CreateFolderRequest(BaseModel):
    name: str


class RenameFolderRequest(BaseModel):
    name: str


# ============================================================
# 账号 CRUD
# ============================================================

@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(EmailAccount).order_by(EmailAccount.created_at).all()


@router.post("/accounts", response_model=AccountOut)
def create_account(body: AccountCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    account = EmailAccount(
        email=body.email,
        display_name=body.display_name or body.email,
        protocol=body.protocol,
        imap_host=body.imap_host,
        imap_port=body.imap_port,
        pop3_host=body.pop3_host,
        pop3_port=body.pop3_port,
        smtp_host=body.smtp_host,
        smtp_port=body.smtp_port,
        username=body.username,
        encrypted_password=encrypt_password(body.password),
        use_ssl=body.use_ssl,
        sync_interval_minutes=body.sync_interval_minutes,
    )
    db.add(account)
    db.flush()  # 获取 account.id

    # POP3 账号：立即创建收件箱文件夹，让 UI 无需等待同步就能显示
    if body.protocol == "pop3":
        inbox = EmailFolder(
            account_id=account.id,
            name="收件箱",
            remote_name="INBOX",
            folder_type="inbox",
            sort_order=0,
        )
        db.add(inbox)

    db.commit()
    db.refresh(account)

    # 后台触发一次初始同步（下载邮件）
    account_id = account.id

    def _initial_sync():
        from database import SessionLocal
        from services.email_pop3 import sync_pop3_emails, sync_pop3_folders
        from services.email_sync import sync_folders, sync_emails
        sdb = SessionLocal()
        try:
            acc = sdb.query(EmailAccount).get(account_id)
            if not acc:
                return
            if acc.protocol == "pop3":
                sync_pop3_folders(acc, sdb)
                sync_pop3_emails(acc, sdb)
            else:
                folders = sync_folders(acc, sdb)
                for f in folders:
                    sync_emails(acc, f, sdb)
            acc.last_sync_at = dt.datetime.utcnow()
            sdb.commit()
        except Exception:
            pass
        finally:
            sdb.close()

    background_tasks.add_task(_initial_sync)
    return account


# 注意：/accounts/test 必须在 /accounts/{account_id} 之前声明，
# 否则 Starlette 会把 "test" 当作 account_id 路径参数匹配，导致 405。
@router.post("/accounts/test")
def test_connection(body: TestConnectionRequest):
    """测试 IMAP/POP3 和 SMTP 连接。"""
    if body.protocol == "pop3":
        recv_result = test_pop3_connection(
            body.pop3_host, body.pop3_port, body.username, body.password, body.use_ssl
        )
        result_key = "pop3"
    else:
        recv_result = test_imap_connection(
            body.imap_host, body.imap_port, body.username, body.password, body.use_ssl
        )
        result_key = "imap"
    smtp_result = test_smtp_connection(
        body.smtp_host, body.smtp_port, body.username, body.password, body.use_ssl
    )
    return {result_key: recv_result, "smtp": smtp_result}


@router.put("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: int, body: AccountUpdate, db: Session = Depends(get_db)):
    account = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(404, "邮箱账号不存在")
    data = body.model_dump(exclude_unset=True)
    if "password" in data:
        data["encrypted_password"] = encrypt_password(data.pop("password"))
    for k, v in data.items():
        setattr(account, k, v)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(404, "邮箱账号不存在")
    # 级联删除邮件和文件夹
    db.query(Email).filter(Email.account_id == account_id).delete()
    db.query(EmailFolder).filter(EmailFolder.account_id == account_id).delete()
    db.delete(account)
    db.commit()
    return {"ok": True}


# ============================================================
# 同步
# ============================================================

@router.post("/accounts/{account_id}/sync")
def trigger_sync(account_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """手动触发同步。"""
    account = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(404, "邮箱账号不存在")

    def _do_sync():
        from database import SessionLocal
        sdb = SessionLocal()
        try:
            acc = sdb.query(EmailAccount).get(account_id)
            if not acc:
                return
            if acc.protocol == "pop3":
                sync_pop3_folders(acc, sdb)
                sync_pop3_emails(acc, sdb)
            else:
                folders = sync_folders(acc, sdb)
                for f in folders:
                    sync_emails(acc, f, sdb)
            acc.last_sync_at = dt.datetime.utcnow()
            sdb.commit()
        finally:
            sdb.close()

    background_tasks.add_task(_do_sync)
    return {"ok": True, "message": "同步已触发"}


# ============================================================
# 文件夹
# ============================================================

@router.get("/accounts/{account_id}/folders", response_model=list[FolderOut])
def list_folders(account_id: int, db: Session = Depends(get_db)):
    account = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(404, "邮箱账号不存在")
    return (
        db.query(EmailFolder)
        .filter_by(account_id=account_id)
        .order_by(EmailFolder.sort_order, EmailFolder.name)
        .all()
    )


@router.post("/accounts/{account_id}/folders", response_model=FolderOut)
def create_folder(account_id: int, body: CreateFolderRequest, db: Session = Depends(get_db)):
    """在账号下创建新文件夹（同时在 IMAP 服务端创建）。"""
    account = db.query(EmailAccount).filter(EmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(404, "邮箱账号不存在")
    if account.protocol == "pop3":
        raise HTTPException(400, "POP3 协议不支持创建文件夹")
    # 尝试在 IMAP 服务端创建
    try:
        from services.email_sync import _connect_imap
        conn = _connect_imap(account)
        conn.create(body.name)
        conn.logout()
    except Exception:
        pass  # 服务端创建失败不影响本地记录
    max_order = db.query(EmailFolder).filter_by(account_id=account_id).count()
    folder = EmailFolder(
        account_id=account_id,
        name=body.name,
        remote_name=body.name,
        folder_type="custom",
        sort_order=max_order,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@router.post("/folders/{folder_id}/read-all")
def mark_folder_read_all(folder_id: int, db: Session = Depends(get_db)):
    """将该文件夹内所有邮件标记为已读。"""
    folder = db.query(EmailFolder).filter(EmailFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(404, "文件夹不存在")
    db.query(Email).filter(
        Email.folder_id == folder_id, Email.is_read == False
    ).update({"is_read": True})
    folder.unread_count = 0
    db.commit()
    return {"ok": True}


@router.put("/folders/{folder_id}/mute")
def toggle_folder_mute(folder_id: int, db: Session = Depends(get_db)):
    """切换文件夹静音状态（静音后不显示未读角标，只显示数字）。"""
    folder = db.query(EmailFolder).filter(EmailFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(404, "文件夹不存在")
    folder.is_muted = not folder.is_muted
    db.commit()
    return {"ok": True, "is_muted": folder.is_muted}


@router.put("/folders/{folder_id}/rename")
def rename_folder(folder_id: int, body: RenameFolderRequest, db: Session = Depends(get_db)):
    """重命名文件夹（仅限 custom 类型，同时尝试重命名 IMAP 服务端文件夹）。"""
    folder = db.query(EmailFolder).filter(EmailFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(404, "文件夹不存在")
    if folder.folder_type != "custom":
        raise HTTPException(400, "系统文件夹不允许重命名")
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(400, "文件夹名称不能为空")
    account = db.query(EmailAccount).filter(EmailAccount.id == folder.account_id).first()
    if account and account.protocol != "pop3":
        try:
            from services.email_sync import _connect_imap
            conn = _connect_imap(account)
            conn.rename(folder.remote_name, new_name)
            conn.logout()
        except Exception:
            pass  # 服务端重命名失败不阻止本地更新
    folder.name = new_name
    folder.remote_name = new_name
    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    """删除文件夹（仅限 custom 类型，同时尝试删除 IMAP 服务端文件夹）。"""
    folder = db.query(EmailFolder).filter(EmailFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(404, "文件夹不存在")
    if folder.folder_type != "custom":
        raise HTTPException(400, "系统文件夹不允许删除")
    account = db.query(EmailAccount).filter(EmailAccount.id == folder.account_id).first()
    if account and account.protocol != "pop3":
        try:
            from services.email_sync import _connect_imap
            conn = _connect_imap(account)
            conn.delete(folder.remote_name)
            conn.logout()
        except Exception:
            pass  # 服务端删除失败不阻止本地删除
    # 级联删除该文件夹下的本地邮件记录
    db.query(Email).filter(Email.folder_id == folder_id).delete()
    db.delete(folder)
    db.commit()
    return {"ok": True}

def _email_to_brief(e: Email) -> dict:
    attachments = json.loads(e.attachments_meta) if e.attachments_meta else []
    return {
        "id": e.id,
        "account_id": e.account_id,
        "folder_id": e.folder_id,
        "subject": e.subject or "(无主题)",
        "from_addr": e.from_addr or "",
        "from_name": e.from_name or "",
        "date": e.date,
        "snippet": e.snippet or "",
        "is_read": e.is_read,
        "is_starred": e.is_starred,
        "has_attachments": len(attachments) > 0,
    }


@router.get("/emails", response_model=list[EmailBrief])
def list_emails(
    account_id: int,
    folder_id: int | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(Email).filter(Email.account_id == account_id)
    if folder_id:
        q = q.filter(Email.folder_id == folder_id)
    if search:
        like = f"%{search}%"
        q = q.filter(
            (Email.subject.ilike(like))
            | (Email.from_addr.ilike(like))
            | (Email.from_name.ilike(like))
            | (Email.snippet.ilike(like))
        )
    total = q.count()
    emails = (
        q.order_by(Email.date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_email_to_brief(e) for e in emails]


@router.get("/emails/{email_id}", response_model=EmailDetail)
def get_email(email_id: int, db: Session = Depends(get_db)):
    e = db.query(Email).filter(Email.id == email_id).first()
    if not e:
        raise HTTPException(404, "邮件不存在")
    # JSON 字段解析
    res = {
        "id": e.id,
        "account_id": e.account_id,
        "folder_id": e.folder_id,
        "message_id": e.message_id or "",
        "subject": e.subject or "",
        "from_addr": e.from_addr or "",
        "from_name": e.from_name or "",
        "to_addrs": json.loads(e.to_addrs) if e.to_addrs else [],
        "cc_addrs": json.loads(e.cc_addrs) if e.cc_addrs else [],
        "bcc_addrs": json.loads(e.bcc_addrs) if e.bcc_addrs else [],
        "date": e.date,
        "body_text": e.body_text or "",
        "body_html": e.body_html or "",
        "attachments_meta": json.loads(e.attachments_meta) if e.attachments_meta else [],
        "is_read": e.is_read,
        "is_starred": e.is_starred,
        "is_draft": e.is_draft,
        "in_reply_to": e.in_reply_to,
        "references_header": e.references_header,
        "created_at": e.created_at,
    }
    return res


# ============================================================
# 邮件操作（已读/星标/移动/删除）
# ============================================================

class MarkReadRequest(BaseModel):
    is_read: bool


@router.put("/emails/{email_id}/read")
def mark_read(email_id: int, body: MarkReadRequest, db: Session = Depends(get_db)):
    e = db.query(Email).filter(Email.id == email_id).first()
    if not e:
        raise HTTPException(404, "邮件不存在")
    account = db.query(EmailAccount).get(e.account_id)
    if not account:
        raise HTTPException(404, "账号不存在")
    mark_email_read(account, e, body.is_read, db)
    return {"ok": True}


class MarkStarRequest(BaseModel):
    is_starred: bool


@router.put("/emails/{email_id}/star")
def mark_star(email_id: int, body: MarkStarRequest, db: Session = Depends(get_db)):
    e = db.query(Email).filter(Email.id == email_id).first()
    if not e:
        raise HTTPException(404, "邮件不存在")
    e.is_starred = body.is_starred
    db.commit()
    return {"ok": True}


class MoveEmailRequest(BaseModel):
    target_folder_id: int


@router.put("/emails/{email_id}/move")
def move_email(email_id: int, body: MoveEmailRequest, db: Session = Depends(get_db)):
    e = db.query(Email).filter(Email.id == email_id).first()
    if not e:
        raise HTTPException(404, "邮件不存在")
    account = db.query(EmailAccount).get(e.account_id)
    if not account:
        raise HTTPException(404, "账号不存在")
    target = db.query(EmailFolder).filter(EmailFolder.id == body.target_folder_id).first()
    if not target:
        raise HTTPException(404, "文件夹不存在")
    move_email_imap(account, e, target, db)
    return {"ok": True}


@router.delete("/emails/{email_id}")
def delete_email(email_id: int, db: Session = Depends(get_db)):
    e = db.query(Email).filter(Email.id == email_id).first()
    if not e:
        raise HTTPException(404, "邮件不存在")
    account = db.query(EmailAccount).get(e.account_id)
    if not account:
        raise HTTPException(404, "账号不存在")
    delete_email_imap(account, e, db)
    return {"ok": True}


# ============================================================
# 发送
# ============================================================

@router.post("/send")
def send_email_endpoint(body: SendEmailRequest, db: Session = Depends(get_db)):
    account = db.query(EmailAccount).filter(EmailAccount.id == body.account_id).first()
    if not account:
        raise HTTPException(404, "邮箱账号不存在")
    try:
        message_id = send_email(
            account=account,
            to_addrs=body.to_addrs,
            subject=body.subject,
            body_text=body.body_text,
            body_html=body.body_html,
            cc_addrs=body.cc_addrs,
            bcc_addrs=body.bcc_addrs,
            in_reply_to=body.in_reply_to,
            references=body.references,
            db=db,
        )
        all_addrs = body.to_addrs + (body.cc_addrs or []) + (body.bcc_addrs or [])
        _upsert_contacts(db, all_addrs)
        return {"ok": True, "message_id": message_id}
    except Exception as e:
        raise HTTPException(500, f"发送失败: {e}")


# ============================================================
# 联系人
# ============================================================

import email.headerregistry as _hdr  # noqa: E402
from email.utils import parseaddr as _parseaddr


def _upsert_contacts(db: Session, addrs: list[str]) -> None:
    """发送后自动归档收件人地址（is_auto=True）。"""
    for raw in addrs:
        _, addr = _parseaddr(raw)
        if not addr or "@" not in addr:
            continue
        addr = addr.lower().strip()
        c = db.query(EmailContact).filter(EmailContact.email == addr).first()
        if c:
            c.send_count = (c.send_count or 0) + 1
            c.last_sent_at = dt.datetime.utcnow()
        else:
            c = EmailContact(
                email=addr,
                name="",
                notes="",
                is_auto=True,
                send_count=1,
                last_sent_at=dt.datetime.utcnow(),
            )
            db.add(c)
    db.commit()


class ContactCreate(BaseModel):
    email: str
    name: str = ""
    notes: str = ""


class ContactUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None


class ContactOut(BaseModel):
    id: int
    email: str
    name: str
    notes: str
    is_auto: bool
    send_count: int
    last_sent_at: dt.datetime | None
    created_at: dt.datetime

    class Config:
        from_attributes = True


@router.get("/contacts", response_model=list[ContactOut])
def list_contacts(q: str = Query(""), db: Session = Depends(get_db)):
    query = db.query(EmailContact)
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            (EmailContact.email.ilike(pattern)) | (EmailContact.name.ilike(pattern))
        )
    return query.order_by(EmailContact.send_count.desc()).all()


@router.post("/contacts", response_model=ContactOut, status_code=201)
def create_contact(body: ContactCreate, db: Session = Depends(get_db)):
    exists = db.query(EmailContact).filter(EmailContact.email == body.email.lower().strip()).first()
    if exists:
        raise HTTPException(409, "联系人已存在")
    c = EmailContact(
        email=body.email.lower().strip(),
        name=body.name,
        notes=body.notes,
        is_auto=False,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.put("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: int, body: ContactUpdate, db: Session = Depends(get_db)):
    c = db.query(EmailContact).get(contact_id)
    if not c:
        raise HTTPException(404, "联系人不存在")
    if body.name is not None:
        c.name = body.name
    if body.notes is not None:
        c.notes = body.notes
    c.is_auto = False
    db.commit()
    db.refresh(c)
    return c


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    c = db.query(EmailContact).get(contact_id)
    if not c:
        raise HTTPException(404, "联系人不存在")
    db.delete(c)
    db.commit()
    return {"ok": True}
