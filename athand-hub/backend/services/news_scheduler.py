"""
新闻调度器 —— 定时抓取新闻 + 生成每日总结。
使用 asyncio 在后台运行，参照 email_scheduler.py 模式。
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor

from database import SessionLocal
from models import NewsSettings

logger = logging.getLogger("news_scheduler")

_executor = ThreadPoolExecutor(max_workers=3)
_task: asyncio.Task | None = None


def _get_settings() -> dict:
    db = SessionLocal()
    try:
        s = db.query(NewsSettings).first()
        if not s:
            return {
                "fetch_time": "07:00",
                "digest_time": "08:00",
                "lookback_hours": 24,
                "follow_builders_enabled": True,
                "timezone": "Asia/Shanghai",
            }
        return {
            "fetch_time": s.fetch_time,
            "digest_time": s.digest_time,
            "lookback_hours": s.lookback_hours,
            "follow_builders_enabled": s.follow_builders_enabled,
            "timezone": s.timezone,
        }
    finally:
        db.close()


def _do_fetch():
    """执行一次全量抓取（在线程池中运行）。"""
    from services.news_fetcher import fetch_all
    from services.news_summarizer import summarize_new_items

    settings = _get_settings()
    total = fetch_all(
        lookback_hours=settings["lookback_hours"],
        include_follow_builders=settings["follow_builders_enabled"],
    )
    logger.info("News fetch completed: %d new items", total)

    # 对新抓取的长文生成摘要
    db = SessionLocal()
    try:
        count = summarize_new_items(db)
        if count:
            logger.info("Summarized %d items", count)
    finally:
        db.close()


def _do_digest():
    """执行一次每日总结生成（在线程池中运行）：生成昨日 daily 总结。"""
    from services.news_digest import generate_digest

    yesterday = dt.date.today() - dt.timedelta(days=1)
    db = SessionLocal()
    try:
        digest = generate_digest(db, target_date=yesterday, digest_type="daily")
        if digest:
            logger.info("Daily digest generated for %s (status=%s)", yesterday, digest.status)
        else:
            logger.info("No items to digest for %s", yesterday)
    finally:
        db.close()


def _parse_time(hm: str) -> tuple[int, int]:
    """解析 HH:MM 字符串。"""
    parts = hm.split(":")
    return int(parts[0]), int(parts[1])


# 记录上次执行日期，避免一天内重复执行
_last_fetch_date: str | None = None
_last_digest_date: str | None = None


async def _scheduler_loop():
    """调度循环：检查当前时间，触发抓取和总结。"""
    global _last_fetch_date, _last_digest_date

    while True:
        try:
            settings = _get_settings()
            now = dt.datetime.now()  # 使用本地时间
            today = now.strftime("%Y-%m-%d")
            current_minutes = now.hour * 60 + now.minute

            fetch_h, fetch_m = _parse_time(settings["fetch_time"])
            fetch_minutes = fetch_h * 60 + fetch_m

            digest_h, digest_m = _parse_time(settings["digest_time"])
            digest_minutes = digest_h * 60 + digest_m

            # 检查是否到了抓取时间（±2 分钟窗口，且今天还没执行过）
            if abs(current_minutes - fetch_minutes) <= 2 and _last_fetch_date != today:
                _last_fetch_date = today
                logger.info("Triggering scheduled news fetch")
                loop = asyncio.get_event_loop()
                loop.run_in_executor(_executor, _do_fetch)

            # 检查是否到了总结时间
            if abs(current_minutes - digest_minutes) <= 2 and _last_digest_date != today:
                _last_digest_date = today
                logger.info("Triggering scheduled digest generation")
                loop = asyncio.get_event_loop()
                loop.run_in_executor(_executor, _do_digest)

        except Exception:
            logger.exception("News scheduler loop error")

        await asyncio.sleep(60)


def start_scheduler():
    """启动新闻调度器。"""
    global _task
    if _task is not None:
        return
    _task = asyncio.create_task(_scheduler_loop())
    logger.info("News scheduler started")


def stop_scheduler():
    """停止新闻调度器。"""
    global _task
    if _task:
        _task.cancel()
        _task = None
        logger.info("News scheduler stopped")
