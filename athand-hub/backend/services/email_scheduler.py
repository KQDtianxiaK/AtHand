"""
后台邮件同步调度器。
使用 asyncio 在后台定期同步所有活跃邮箱账号。
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor

from database import SessionLocal
from models import EmailAccount
from services.email_sync import sync_emails, sync_folders
from services.email_pop3 import sync_pop3_emails, sync_pop3_folders

logger = logging.getLogger("email_scheduler")

_executor = ThreadPoolExecutor(max_workers=2)
_task: asyncio.Task | None = None


def _sync_account(account_id: int):
    """同步单个账号（在线程池中运行）。"""
    db = SessionLocal()
    try:
        account = db.query(EmailAccount).get(account_id)
        if not account or not account.is_active:
            return

        if account.protocol == "pop3":
            sync_pop3_folders(account, db)
            sync_pop3_emails(account, db)
        else:
            # IMAP 同步文件夹 + 邮件
            folders = sync_folders(account, db)
            for folder in folders:
                try:
                    sync_emails(account, folder, db)
                except Exception:
                    logger.exception("Sync failed for folder %s of account %s",
                                     folder.remote_name, account.email)

        # 更新最后同步时间
        account.last_sync_at = dt.datetime.utcnow()
        db.commit()
        logger.info("Synced account %s", account.email)

    except Exception:
        logger.exception("Failed to sync account %d", account_id)
    finally:
        db.close()


async def _scheduler_loop():
    """调度循环：检查需要同步的账号并触发同步。"""
    while True:
        try:
            db = SessionLocal()
            try:
                accounts = db.query(EmailAccount).filter_by(is_active=True).all()
                now = dt.datetime.utcnow()

                for account in accounts:
                    interval = account.sync_interval_minutes or 5
                    if account.last_sync_at:
                        next_sync = account.last_sync_at + dt.timedelta(minutes=interval)
                        if now < next_sync:
                            continue

                    # 在线程池中执行同步（IMAP 是阻塞式 IO）
                    loop = asyncio.get_event_loop()
                    loop.run_in_executor(_executor, _sync_account, account.id)
            finally:
                db.close()

        except Exception:
            logger.exception("Scheduler loop error")

        # 每 60 秒检查一次
        await asyncio.sleep(60)


def start_scheduler():
    """启动后台同步调度器。"""
    global _task
    if _task is not None:
        return
    _task = asyncio.create_task(_scheduler_loop())
    logger.info("Email sync scheduler started")


def stop_scheduler():
    """停止后台同步调度器。"""
    global _task
    if _task:
        _task.cancel()
        _task = None
        logger.info("Email sync scheduler stopped")
