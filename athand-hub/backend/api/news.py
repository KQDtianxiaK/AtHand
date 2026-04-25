"""
新闻管理 API 路由。
- 信息源 CRUD
- 新闻条目列表/详情/已读
- 每日总结生成/查看
- 设置管理
- 手动抓取
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
from database import get_db, SessionLocal
from models import NewsDigest, NewsItem, NewsSettings, NewsSource
from services.email_crypto import encrypt_password, decrypt_password

router = APIRouter(prefix="/api/news", tags=["news"], dependencies=[Depends(get_current_user)])

_executor = ThreadPoolExecutor(max_workers=2)


# ============================================================
# Pydantic schemas
# ============================================================

class SourceCreate(BaseModel):
    name: str
    source_type: str  # x_account / rss / blog
    url: str = ""
    api_key: str = ""  # 明文，将被加密存储
    config_json: str = "{}"
    category: str = ""
    enabled: bool = True


class SourceUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    api_key: str | None = None
    config_json: str | None = None
    category: str | None = None
    enabled: bool | None = None


class SourceOut(BaseModel):
    id: int
    name: str
    source_type: str
    url: str
    has_api_key: bool
    config_json: str
    category: str
    enabled: bool
    last_fetch_at: str | None
    created_at: str

    @classmethod
    def from_model(cls, s: NewsSource) -> "SourceOut":
        return cls(
            id=s.id,
            name=s.name,
            source_type=s.source_type,
            url=s.url,
            has_api_key=bool(s.api_key),
            config_json=s.config_json,
            category=s.category,
            enabled=s.enabled,
            last_fetch_at=s.last_fetch_at.isoformat() if s.last_fetch_at else None,
            created_at=s.created_at.isoformat() if s.created_at else "",
        )


class NewsItemOut(BaseModel):
    id: int
    source_id: int
    source_name: str
    source_type: str
    title: str
    content: str
    summary: str
    original_url: str
    author: str
    published_at: str | None
    fetched_at: str
    item_type: str
    metadata_json: str
    is_read: bool

    @classmethod
    def from_model(cls, item: NewsItem, source: NewsSource | None = None) -> "NewsItemOut":
        return cls(
            id=item.id,
            source_id=item.source_id,
            source_name=source.name if source else "",
            source_type=source.source_type if source else "",
            title=item.title,
            content=item.content,
            summary=item.summary,
            original_url=item.original_url,
            author=item.author,
            published_at=item.published_at.isoformat() if item.published_at else None,
            fetched_at=item.fetched_at.isoformat() if item.fetched_at else "",
            item_type=item.item_type,
            metadata_json=item.metadata_json,
            is_read=item.is_read,
        )


class DigestOut(BaseModel):
    id: int
    date: str
    digest_type: str
    title: str
    content: str
    status: str
    item_count: int
    is_read: bool
    generated_at: str | None
    created_at: str

    @classmethod
    def from_model(cls, d: NewsDigest) -> "DigestOut":
        return cls(
            id=d.id,
            date=d.date.isoformat() if d.date else "",
            digest_type=getattr(d, "digest_type", "daily") or "daily",
            title=d.title,
            content=d.content,
            status=d.status,
            item_count=d.item_count,
            is_read=d.is_read,
            generated_at=d.generated_at.isoformat() + "Z" if d.generated_at else None,
            created_at=d.created_at.isoformat() if d.created_at else "",
        )


class SettingsOut(BaseModel):
    fetch_time: str
    digest_time: str
    lookback_hours: int
    digest_prompt: str
    digest_language: str
    notification_enabled: bool
    follow_builders_enabled: bool
    timezone: str


class SettingsUpdate(BaseModel):
    fetch_time: str | None = None
    digest_time: str | None = None
    lookback_hours: int | None = None
    digest_prompt: str | None = None
    digest_language: str | None = None
    notification_enabled: bool | None = None
    follow_builders_enabled: bool | None = None
    timezone: str | None = None


# ============================================================
# 辅助
# ============================================================

def _get_settings(db: Session) -> NewsSettings:
    s = db.query(NewsSettings).first()
    if not s:
        s = NewsSettings(id=1)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


# ============================================================
# 信息源 CRUD
# ============================================================

@router.get("/sources", response_model=list[SourceOut])
def list_sources(db: Session = Depends(get_db)):
    sources = db.query(NewsSource).order_by(NewsSource.created_at.desc()).all()
    return [SourceOut.from_model(s) for s in sources]


@router.post("/sources", response_model=SourceOut, status_code=201)
def create_source(body: SourceCreate, db: Session = Depends(get_db)):
    src = NewsSource(
        name=body.name,
        source_type=body.source_type,
        url=body.url,
        api_key=encrypt_password(body.api_key) if body.api_key else "",
        config_json=body.config_json,
        category=body.category,
        enabled=body.enabled,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    return SourceOut.from_model(src)


@router.put("/sources/{source_id}", response_model=SourceOut)
def update_source(source_id: int, body: SourceUpdate, db: Session = Depends(get_db)):
    src = db.query(NewsSource).get(source_id)
    if not src:
        raise HTTPException(404, "Source not found")
    if body.name is not None:
        src.name = body.name
    if body.url is not None:
        src.url = body.url
    if body.api_key is not None:
        src.api_key = encrypt_password(body.api_key) if body.api_key else ""
    if body.config_json is not None:
        src.config_json = body.config_json
    if body.category is not None:
        src.category = body.category
    if body.enabled is not None:
        src.enabled = body.enabled
    db.commit()
    db.refresh(src)
    return SourceOut.from_model(src)


@router.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)):
    src = db.query(NewsSource).get(source_id)
    if not src:
        raise HTTPException(404, "Source not found")
    db.delete(src)
    db.commit()
    return {"ok": True}


@router.post("/sources/{source_id}/test")
def test_source(source_id: int, db: Session = Depends(get_db)):
    """测试信息源是否可连通。"""
    src = db.query(NewsSource).get(source_id)
    if not src:
        raise HTTPException(404, "Source not found")

    import httpx
    try:
        url = src.url
        if src.source_type == "follow_builders":
            # 内置源：测试能否访问 GitHub raw feed
            resp = httpx.get(
                "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json",
                timeout=15,
                follow_redirects=True,
            )
            if resp.status_code == 200:
                data = resp.json()
                builder_count = len(data.get("x", []))
                return {"status": "ok", "message": f"连接成功，共 {builder_count} 位 Builder"}
            return {"status": "error", "message": f"GitHub 返回 {resp.status_code}"}
        elif src.source_type == "x_account":
            # 测试 X API 连通性
            api_key = decrypt_password(src.api_key) if src.api_key else ""
            if not api_key:
                return {"status": "error", "message": "未配置 API Key"}
            config = json.loads(src.config_json or "{}")
            handle = config.get("handle", src.url or "").lstrip("@")
            resp = httpx.get(
                f"https://api.x.com/2/users/by/username/{handle}",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15,
            )
            if resp.status_code == 200:
                return {"status": "ok", "message": f"连接成功: {resp.json().get('data', {}).get('name', handle)}"}
            return {"status": "error", "message": f"API 返回 {resp.status_code}"}
        else:
            # RSS / 博客: 简单 GET 测试 (带 User-Agent 避免反爬 403)
            resp = httpx.get(
                url,
                timeout=15,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"},
            )
            if resp.status_code == 200:
                return {"status": "ok", "message": f"连接成功 (HTTP {resp.status_code})"}
            return {"status": "error", "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ============================================================
# 新闻条目
# ============================================================

@router.get("/items", response_model=list[NewsItemOut])
def list_items(
    source_type: str | None = None,
    item_type: str | None = None,
    category: str | None = None,
    date: str | None = None,
    is_read: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(NewsItem).join(NewsSource)

    if source_type:
        q = q.filter(NewsSource.source_type == source_type)
    if item_type:
        q = q.filter(NewsItem.item_type == item_type)
    if category:
        q = q.filter(NewsSource.category == category)
    if date:
        try:
            d = dt.date.fromisoformat(date)
            q = q.filter(
                NewsItem.fetched_at >= dt.datetime.combine(d, dt.time.min),
                NewsItem.fetched_at < dt.datetime.combine(d + dt.timedelta(days=1), dt.time.min),
            )
        except ValueError:
            pass
    if is_read is not None:
        q = q.filter(NewsItem.is_read == is_read)

    items = q.order_by(NewsItem.published_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # 预加载 source 信息
    source_cache: dict[int, NewsSource] = {}
    for item in items:
        if item.source_id not in source_cache:
            source_cache[item.source_id] = db.query(NewsSource).get(item.source_id)

    return [NewsItemOut.from_model(item, source_cache.get(item.source_id)) for item in items]


@router.get("/items/{item_id}", response_model=NewsItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(NewsItem).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    source = db.query(NewsSource).get(item.source_id)
    return NewsItemOut.from_model(item, source)


@router.put("/items/{item_id}/read")
def mark_item_read(item_id: int, db: Session = Depends(get_db)):
    item = db.query(NewsItem).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    item.is_read = True
    db.commit()
    return {"ok": True}


# ============================================================
# 每日总结
# ============================================================

@router.get("/digests", response_model=list[DigestOut])
def list_digests(
    limit: int = Query(30, ge=1, le=100),
    digest_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(NewsDigest).order_by(NewsDigest.date.desc())
    if digest_type:
        q = q.filter(NewsDigest.digest_type == digest_type)
    digests = q.limit(limit).all()
    return [DigestOut.from_model(d) for d in digests]


@router.get("/digests/latest", response_model=DigestOut | None)
def get_latest_digest(digest_type: str = Query("daily"), db: Session = Depends(get_db)):
    d = (
        db.query(NewsDigest)
        .filter(NewsDigest.digest_type == digest_type)
        .order_by(NewsDigest.date.desc(), NewsDigest.id.desc())
        .first()
    )
    if not d:
        return None
    return DigestOut.from_model(d)


@router.get("/digests/{digest_id}", response_model=DigestOut)
def get_digest(digest_id: int, db: Session = Depends(get_db)):
    d = db.query(NewsDigest).get(digest_id)
    if not d:
        raise HTTPException(404, "Digest not found")
    return DigestOut.from_model(d)


@router.put("/digests/{digest_id}/read")
def mark_digest_read(digest_id: int, db: Session = Depends(get_db)):
    d = db.query(NewsDigest).get(digest_id)
    if not d:
        raise HTTPException(404, "Digest not found")
    d.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/digests/generate")
def trigger_digest(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """手动触发生成昨日 daily 总结（强制重新生成）。"""

    def _gen():
        from services.news_digest import generate_digest
        import datetime as _dt
        _db = SessionLocal()
        yesterday = _dt.date.today() - _dt.timedelta(days=1)
        try:
            generate_digest(_db, target_date=yesterday, force=True, digest_type="daily")
        finally:
            _db.close()

    from database import SessionLocal
    background_tasks.add_task(_gen)
    return {"ok": True, "message": "昨日总结生成已启动"}


@router.post("/digests/generate-today")
def trigger_today_digest(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """手动触发今日速览：先抓取今日新闻，再生成 today 类型总结。"""

    def _gen():
        from services.news_fetcher import fetch_all
        from services.news_summarizer import summarize_new_items
        from services.news_digest import generate_digest
        import datetime as _dt

        _db = SessionLocal()
        try:
            settings = _get_settings(_db)
            fetch_all(
                lookback_hours=max(settings.lookback_hours, 24),
                include_follow_builders=settings.follow_builders_enabled,
            )
            summarize_new_items(_db)
            generate_digest(_db, target_date=_dt.date.today(), force=True, digest_type="today")
        finally:
            _db.close()

    from database import SessionLocal
    background_tasks.add_task(_gen)
    return {"ok": True, "message": "今日速览生成已启动"}


# ============================================================
# 手动抓取
# ============================================================

@router.post("/fetch")
def trigger_fetch(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """手动触发全量抓取。"""

    def _fetch():
        from services.news_fetcher import fetch_all
        from services.news_summarizer import summarize_new_items
        settings = _get_settings(_db := SessionLocal())
        try:
            # 手动抓取使用更长的回溯窗口（7天），保证首次使用能拉到内容。
            # 正常定时任务仍使用 settings.lookback_hours。
            fetch_all(
                lookback_hours=max(settings.lookback_hours, 168),
                include_follow_builders=settings.follow_builders_enabled,
            )
            summarize_new_items(_db)
        finally:
            _db.close()

    background_tasks.add_task(_fetch)
    return {"ok": True, "message": "新闻抓取已启动"}


# ============================================================
# 设置
# ============================================================

@router.get("/settings", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db)):
    s = _get_settings(db)
    return SettingsOut(
        fetch_time=s.fetch_time,
        digest_time=s.digest_time,
        lookback_hours=s.lookback_hours,
        digest_prompt=s.digest_prompt,
        digest_language=s.digest_language,
        notification_enabled=s.notification_enabled,
        follow_builders_enabled=s.follow_builders_enabled,
        timezone=s.timezone,
    )


@router.put("/settings")
def update_settings(body: SettingsUpdate, db: Session = Depends(get_db)):
    s = _get_settings(db)
    if body.fetch_time is not None:
        s.fetch_time = body.fetch_time
    if body.digest_time is not None:
        s.digest_time = body.digest_time
    if body.lookback_hours is not None:
        s.lookback_hours = body.lookback_hours
    if body.digest_prompt is not None:
        s.digest_prompt = body.digest_prompt
    if body.digest_language is not None:
        s.digest_language = body.digest_language
    if body.notification_enabled is not None:
        s.notification_enabled = body.notification_enabled
    if body.follow_builders_enabled is not None:
        s.follow_builders_enabled = body.follow_builders_enabled
    if body.timezone is not None:
        s.timezone = body.timezone
    db.commit()
    return {"ok": True}


# ============================================================
# 统计（供 Dashboard 使用）
# ============================================================

@router.get("/stats")
def get_news_stats(db: Session = Depends(get_db)):
    today = dt.date.today()
    day_start = dt.datetime.combine(today, dt.time.min)
    day_end = dt.datetime.combine(today + dt.timedelta(days=1), dt.time.min)

    today_count = db.query(NewsItem).filter(
        NewsItem.fetched_at >= day_start,
        NewsItem.fetched_at < day_end,
    ).count()

    total_count = db.query(NewsItem).count()
    source_count = db.query(NewsSource).filter_by(enabled=True).count()

    latest_digest = db.query(NewsDigest).order_by(NewsDigest.date.desc()).first()

    return {
        "today_count": today_count,
        "total_count": total_count,
        "source_count": source_count,
        "latest_digest": DigestOut.from_model(latest_digest) if latest_digest else None,
    }
