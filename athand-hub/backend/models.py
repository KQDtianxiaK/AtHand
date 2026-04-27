from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


# ---------- 机器 ----------
class Machine(Base):
    __tablename__ = "machines"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 自定义 ID
    name: Mapped[str] = mapped_column(String(128))
    machine_type: Mapped[str] = mapped_column(String(32), default="linux")  # pc / workstation / server
    os_info: Mapped[str | None] = mapped_column(String(256))
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_heartbeat: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


# ---------- 备忘录 ----------
class Memo(Base):
    __tablename__ = "memos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(String(512), default="")  # 逗号分隔
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ---------- 待办列表 ----------
class TodoList(Base):
    __tablename__ = "todo_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    emoji: Mapped[str] = mapped_column(String(16), default="📋")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())

    todos: Mapped[list[Todo]] = relationship(back_populates="todo_list")


# ---------- 待办事项 ----------
class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[int] = mapped_column(Integer, default=2)  # 0=P0 紧急, 1=P1, 2=P2, 3=P3
    tags: Mapped[str] = mapped_column(String(512), default="")
    due_date: Mapped[dt.datetime | None] = mapped_column(DateTime)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    is_important: Mapped[bool] = mapped_column(Boolean, default=False)
    my_day_date: Mapped[dt.date | None] = mapped_column(Date)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    recurrence: Mapped[str | None] = mapped_column(String(50), nullable=True)
    list_id: Mapped[int | None] = mapped_column(ForeignKey("todo_lists.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    todo_list: Mapped[TodoList | None] = relationship(back_populates="todos")


# ---------- 打卡记录 ----------
class ClockRecord(Base):
    __tablename__ = "clock_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clock_in: Mapped[dt.datetime] = mapped_column(DateTime)
    clock_out: Mapped[dt.datetime | None] = mapped_column(DateTime)
    note: Mapped[str] = mapped_column(Text, default="")
    # morning / afternoon / evening
    period: Mapped[str] = mapped_column(String(16), default="morning")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


# ---------- 邮箱账号 ----------
class EmailAccount(Base):
    __tablename__ = "email_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(256))
    display_name: Mapped[str] = mapped_column(String(128), default="")
    protocol: Mapped[str] = mapped_column(String(8), default="imap")  # imap / pop3
    imap_host: Mapped[str] = mapped_column(String(256), default="")
    imap_port: Mapped[int] = mapped_column(Integer, default=993)
    pop3_host: Mapped[str] = mapped_column(String(256), default="")  # POP3 服务器
    pop3_port: Mapped[int] = mapped_column(Integer, default=995)      # POP3 端口
    smtp_host: Mapped[str] = mapped_column(String(256))
    smtp_port: Mapped[int] = mapped_column(Integer, default=465)
    username: Mapped[str] = mapped_column(String(256))
    encrypted_password: Mapped[str] = mapped_column(Text, default="")  # Fernet 加密
    use_ssl: Mapped[bool] = mapped_column(Boolean, default=True)
    sync_interval_minutes: Mapped[int] = mapped_column(Integer, default=5)
    last_sync_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())

    folders: Mapped[list["EmailFolder"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    emails: Mapped[list["Email"]] = relationship(back_populates="account", cascade="all, delete-orphan")


# ---------- 邮箱文件夹 ----------
class EmailFolder(Base):
    __tablename__ = "email_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("email_accounts.id"))
    name: Mapped[str] = mapped_column(String(256))  # 显示名
    remote_name: Mapped[str] = mapped_column(String(512))  # IMAP 上的实际名(如 INBOX, Sent Messages)
    folder_type: Mapped[str] = mapped_column(String(32), default="custom")  # inbox/sent/drafts/trash/spam/custom
    unread_count: Mapped[int] = mapped_column(Integer, default=0)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False)  # 静音：只显示数字，不显示未读红点

    account: Mapped["EmailAccount"] = relationship(back_populates="folders")
    emails: Mapped[list["Email"]] = relationship(back_populates="folder", cascade="all, delete-orphan")


# ---------- 邮件 ----------
class Email(Base):
    __tablename__ = "emails"
    __table_args__ = (
        Index("ix_emails_account_folder", "account_id", "folder_id"),
        Index("ix_emails_account_uid", "account_id", "uid", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("email_accounts.id"))
    folder_id: Mapped[int] = mapped_column(ForeignKey("email_folders.id"))
    message_id: Mapped[str | None] = mapped_column(String(512))  # RFC Message-ID
    uid: Mapped[int | None] = mapped_column(Integer)  # IMAP UID
    subject: Mapped[str] = mapped_column(String(1024), default="")
    from_addr: Mapped[str] = mapped_column(String(256), default="")
    from_name: Mapped[str] = mapped_column(String(256), default="")
    to_addrs: Mapped[str] = mapped_column(Text, default="[]")  # JSON
    cc_addrs: Mapped[str] = mapped_column(Text, default="[]")  # JSON
    bcc_addrs: Mapped[str] = mapped_column(Text, default="[]")  # JSON
    date: Mapped[dt.datetime | None] = mapped_column(DateTime)
    body_text: Mapped[str] = mapped_column(Text, default="")
    body_html: Mapped[str] = mapped_column(Text, default="")
    attachments_meta: Mapped[str] = mapped_column(Text, default="[]")  # JSON [{filename, size, content_type}]
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    in_reply_to: Mapped[str | None] = mapped_column(String(512))
    references_header: Mapped[str] = mapped_column(Text, default="")  # space-separated message-ids
    snippet: Mapped[str] = mapped_column(String(500), default="")  # 前200字摘要
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())

    account: Mapped["EmailAccount"] = relationship(back_populates="emails")
    folder: Mapped["EmailFolder"] = relationship(back_populates="emails")


# ---------- 新闻信息源 ----------
class NewsSource(Base):
    __tablename__ = "news_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256))
    source_type: Mapped[str] = mapped_column(String(32))  # x_account / rss / blog / follow_builders
    url: Mapped[str] = mapped_column(String(1024), default="")  # RSS URL / 博客 URL / X handle
    api_key: Mapped[str] = mapped_column(Text, default="")  # 加密存储的用户 API key
    config_json: Mapped[str] = mapped_column(Text, default="{}")  # 额外配置 JSON
    category: Mapped[str] = mapped_column(String(128), default="")  # 用户自定义分类
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_fetch_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    items: Mapped[list["NewsItem"]] = relationship(back_populates="source", cascade="all, delete-orphan")


# ---------- 新闻条目 ----------
class NewsItem(Base):
    __tablename__ = "news_items"
    __table_args__ = (
        Index("ix_news_items_external", "external_id", unique=True),
        Index("ix_news_items_published", "published_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("news_sources.id"))
    title: Mapped[str] = mapped_column(String(1024), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # 原文
    summary: Mapped[str] = mapped_column(Text, default="")  # AI 摘要（长文才有）
    original_url: Mapped[str] = mapped_column(String(2048), default="")
    author: Mapped[str] = mapped_column(String(256), default="")
    published_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    item_type: Mapped[str] = mapped_column(String(32), default="article")  # tweet / podcast / blog_post / article
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")  # likes/retweets 等
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    external_id: Mapped[str] = mapped_column(String(512), unique=True)  # 去重用

    source: Mapped["NewsSource"] = relationship(back_populates="items")


# ---------- 新闻每日总结 ----------
class NewsDigest(Base):
    __tablename__ = "news_digests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[dt.date] = mapped_column(Date)
    # "daily" = 定时自动生成的昨日总结; "today" = 用户手动触发的今日速览
    digest_type: Mapped[str] = mapped_column(String(16), default="daily")
    title: Mapped[str] = mapped_column(String(256), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # Markdown
    prompt_used: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending / generating / ready / failed
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    generated_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


# ---------- 新闻设置（单例） ----------
class NewsSettings(Base):
    __tablename__ = "news_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    fetch_time: Mapped[str] = mapped_column(String(8), default="07:00")  # HH:MM
    digest_time: Mapped[str] = mapped_column(String(8), default="08:00")  # HH:MM
    lookback_hours: Mapped[int] = mapped_column(Integer, default=24)
    digest_prompt: Mapped[str] = mapped_column(Text, default="")  # 空=使用默认
    digest_language: Mapped[str] = mapped_column(String(16), default="zh")  # zh / en / bilingual
    notification_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    follow_builders_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Shanghai")


# ---------- 邮件联系人 ----------
class EmailContact(Base):
    __tablename__ = "email_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256), default="")   # 用户自定义显示名
    notes: Mapped[str] = mapped_column(Text, default="")          # 备注
    is_auto: Mapped[bool] = mapped_column(Boolean, default=False)  # True=自动从发件历史保存
    send_count: Mapped[int] = mapped_column(Integer, default=0)    # 累计发信次数（排序用）
    last_sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
