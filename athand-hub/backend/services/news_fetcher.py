"""
新闻抓取服务 —— 支持 X/Twitter, RSS, 博客 HTML, follow-builders 内置源。
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

from database import SessionLocal
from models import NewsItem, NewsSource

logger = logging.getLogger("news_fetcher")

# follow-builders GitHub raw URL
_FB_BASE = "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main"
_FB_FEEDS = {
    "x": f"{_FB_BASE}/feed-x.json",
    "podcasts": f"{_FB_BASE}/feed-podcasts.json",
    "blogs": f"{_FB_BASE}/feed-blogs.json",
}

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
_TIMEOUT = httpx.Timeout(30.0)


# ============================================================
# 公共工具函数
# ============================================================

def _parse_iso(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _cutoff(lookback_hours: int) -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=lookback_hours)


def _item_exists(db, external_id: str) -> bool:
    return db.query(NewsItem.id).filter_by(external_id=external_id).first() is not None


# t.co 短链解析 — 找推文里嵌着的图片 URL
_TCO_RE = re.compile(r"https?://t\.co/\S+")
_IMG_EXTS = re.compile(r"\.(jpg|jpeg|png|gif|webp)(\?.*)?$", re.IGNORECASE)
_IMG_HOSTS = re.compile(r"pbs\.twimg\.com/media/|twimg\.com/ext_tw_video_thumb/|twimg\.com/tweet_video_thumb/", re.IGNORECASE)
_VXTWITTER_UA = "TelegramBot (like TwitterBot)"


def _resolve_tco_images(text: str, client: httpx.Client) -> list[str]:
    """尝试解析推文文本中的 t.co 短链，返回最终指向图片的 URL 列表。"""
    image_urls: list[str] = []
    for m in _TCO_RE.finditer(text):
        tco = m.group()
        try:
            # 跟随重定向，最多 3 跳，超时 3 秒
            resp = client.head(tco, follow_redirects=True, timeout=3.0)
            final = str(resp.url)
            if _IMG_HOSTS.search(final) or _IMG_EXTS.search(final.split("?")[0]):
                image_urls.append(final)
        except Exception:
            pass
    return image_urls


def _get_tweet_media(handle: str, tweet_id: str, client: httpx.Client) -> list[str]:
    """通过 vxtwitter 公开 API 获取推文媒体图片 URL 列表。无图则返回空列表。"""
    try:
        resp = httpx.get(
            f"https://api.vxtwitter.com/{handle}/status/{tweet_id}",
            headers={"User-Agent": _VXTWITTER_UA},
            follow_redirects=True,
            timeout=5.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            return [u for u in data.get("mediaURLs", []) if _IMG_HOSTS.search(u) or _IMG_EXTS.search(u.split("?")[0])]
    except Exception:
        pass
    return []


def _save_item(db, **kwargs) -> NewsItem | None:
    ext_id = kwargs.get("external_id", "")
    if _item_exists(db, ext_id):
        return None
    item = NewsItem(**kwargs)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


# ============================================================
# 1. X/Twitter 抓取 (用户自有 API Key)
# ============================================================

def fetch_x_account(source: NewsSource, lookback_hours: int, db) -> list[NewsItem]:
    """通过 X API v2 获取指定账号的推文。"""
    from services.email_crypto import decrypt_password

    config = json.loads(source.config_json or "{}")
    handle = config.get("handle", source.url or "").lstrip("@")
    if not handle:
        logger.warning("X source %s: no handle configured", source.name)
        return []

    api_key = decrypt_password(source.api_key) if source.api_key else ""
    if not api_key:
        logger.warning("X source %s: no API key", source.name)
        return []

    headers = {"Authorization": f"Bearer {api_key}"}
    items: list[NewsItem] = []

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            # 获取 user_id
            resp = client.get(
                f"https://api.x.com/2/users/by/username/{handle}",
                headers=headers,
            )
            resp.raise_for_status()
            user_data = resp.json().get("data", {})
            user_id = user_data.get("id")
            if not user_id:
                logger.warning("X source %s: user not found for handle %s", source.name, handle)
                return []

            # 获取推文
            cutoff = _cutoff(lookback_hours)
            params = {
                "max_results": 10,
                "tweet.fields": "created_at,public_metrics,note_tweet",
                "exclude": "retweets,replies",
                "start_time": cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            resp = client.get(
                f"https://api.x.com/2/users/{user_id}/tweets",
                headers=headers,
                params=params,
            )
            if resp.status_code == 429:
                logger.warning("X API rate limited for %s", handle)
                return []
            resp.raise_for_status()

            tweets = resp.json().get("data", [])
            for tw in tweets[:5]:
                tid = tw["id"]
                ext_id = f"x:{tid}"
                text = tw.get("note_tweet", {}).get("text") or tw.get("text", "")
                metrics = tw.get("public_metrics", {})
                pub_at = _parse_iso(tw.get("created_at"))
                url = f"https://x.com/{handle}/status/{tid}"

                item = _save_item(
                    db,
                    source_id=source.id,
                    title=f"@{handle}",
                    content=text,
                    original_url=url,
                    author=source.name,
                    published_at=pub_at,
                    item_type="tweet",
                    metadata_json=json.dumps(metrics),
                    external_id=ext_id,
                )
                if item:
                    items.append(item)

    except Exception:
        logger.exception("Failed to fetch X account %s", source.name)

    return items


# ============================================================
# 2. RSS 抓取
# ============================================================

def fetch_rss(source: NewsSource, lookback_hours: int, db) -> list[NewsItem]:
    """使用 feedparser 抓取 RSS/Atom 源。"""
    import feedparser
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

    url = source.url
    if not url:
        return []

    # 将 config_json["params"] 中的键值追加到 URL 查询参数（支持 BestBlogs 等过滤参数）
    try:
        _cfg = json.loads(source.config_json or "{}")
        _extra = {k: v for k, v in _cfg.get("params", {}).items()
                  if v and (not isinstance(v, list) or v)}
        if _extra:
            _parsed = urlparse(url)
            _qs = parse_qs(_parsed.query, keep_blank_values=True)
            for k, v in _extra.items():
                if isinstance(v, list):
                    _qs[k] = [str(i) for i in v if i]
                else:
                    _qs[k] = [str(v)]
            url = urlunparse(_parsed._replace(
                query=urlencode([(k, vi) for k, vs in _qs.items() for vi in vs])
            ))
    except Exception:
        pass

    items: list[NewsItem] = []
    cutoff = _cutoff(lookback_hours)

    try:
        feed = feedparser.parse(url, agent=_USER_AGENT)
        for entry in feed.entries[:20]:
            # 解析发布时间
            pub_struct = entry.get("published_parsed") or entry.get("updated_parsed")
            if pub_struct:
                pub_at = dt.datetime(*pub_struct[:6], tzinfo=dt.timezone.utc)
            else:
                pub_at = dt.datetime.now(dt.timezone.utc)

            if pub_at < cutoff:
                continue

            ext_id = f"rss:{entry.get('id') or entry.get('link', '')}"
            link = entry.get("link", "")
            title = entry.get("title", "")
            # 正文：优先 content，fallback summary
            content = ""
            if hasattr(entry, "content") and entry.content:
                content = entry.content[0].get("value", "")
            if not content:
                content = entry.get("summary", "")
            # 去 HTML 标签
            if content and "<" in content:
                content = BeautifulSoup(content, "html.parser").get_text(separator="\n", strip=True)

            author = entry.get("author", source.name)

            item = _save_item(
                db,
                source_id=source.id,
                title=title,
                content=content,
                original_url=link,
                author=author,
                published_at=pub_at,
                item_type="article",
                external_id=ext_id,
            )
            if item:
                items.append(item)

    except Exception:
        logger.exception("Failed to fetch RSS %s", source.name)

    return items


# ============================================================
# 3. 博客 HTML 抓取
# ============================================================

def fetch_blog(source: NewsSource, lookback_hours: int, db) -> list[NewsItem]:
    """抓取博客页面——多策略回退提取文章。"""
    url = source.url
    if not url:
        return []

    items: list[NewsItem] = []

    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(url, headers={"User-Agent": _USER_AGENT})
            resp.raise_for_status()
            html = resp.text

        articles = _extract_articles_from_html(html, url)
        cutoff = _cutoff(lookback_hours)

        for art in articles[:5]:
            pub_at = _parse_iso(art.get("publishedAt")) or dt.datetime.now(dt.timezone.utc)
            if pub_at.tzinfo is None:
                pub_at = pub_at.replace(tzinfo=dt.timezone.utc)
            if pub_at < cutoff:
                continue

            ext_id = f"blog:{art['url']}"
            item = _save_item(
                db,
                source_id=source.id,
                title=art.get("title", ""),
                content=art.get("content", ""),
                original_url=art.get("url", ""),
                author=art.get("author", source.name),
                published_at=pub_at,
                item_type="blog_post",
                external_id=ext_id,
            )
            if item:
                items.append(item)

    except Exception:
        logger.exception("Failed to fetch blog %s", source.name)

    return items


def _extract_articles_from_html(html: str, base_url: str) -> list[dict]:
    """尝试多策略从 HTML 中提取文章信息。"""
    # 策略1: JSON-LD
    articles = _try_jsonld(html, base_url)
    if articles:
        return articles

    # 策略2: <article> 标签
    articles = _try_article_tags(html, base_url)
    if articles:
        return articles

    return []


def _try_jsonld(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                if item.get("@type") in ("Article", "BlogPosting", "NewsArticle"):
                    results.append({
                        "title": item.get("headline", ""),
                        "url": item.get("url", base_url),
                        "content": item.get("articleBody", item.get("description", "")),
                        "author": _extract_author(item),
                        "publishedAt": item.get("datePublished", ""),
                    })
        except (json.JSONDecodeError, TypeError):
            continue
    return results


def _try_article_tags(html: str, base_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for article in soup.find_all("article"):
        title_el = article.find(["h1", "h2", "h3"])
        link_el = article.find("a", href=True)
        time_el = article.find("time")
        title = title_el.get_text(strip=True) if title_el else ""
        link = link_el["href"] if link_el else ""
        if link and not link.startswith("http"):
            from urllib.parse import urljoin
            link = urljoin(base_url, link)
        pub = time_el.get("datetime", "") if time_el else ""
        content = article.get_text(separator="\n", strip=True)
        if title:
            results.append({
                "title": title,
                "url": link or base_url,
                "content": content,
                "author": "",
                "publishedAt": pub,
            })
    return results


def _extract_author(item: dict) -> str:
    author = item.get("author", "")
    if isinstance(author, dict):
        return author.get("name", "")
    if isinstance(author, list) and author:
        return author[0].get("name", "") if isinstance(author[0], dict) else str(author[0])
    return str(author)


# ============================================================
# 4. follow-builders 内置源
# ============================================================

def fetch_follow_builders(lookback_hours: int, db) -> list[NewsItem]:
    """从 follow-builders GitHub 仓库获取已抓取好的 feed 数据。"""
    # 创建或获取一个虚拟 source
    fb_source = db.query(NewsSource).filter_by(source_type="follow_builders").first()
    if not fb_source:
        fb_source = NewsSource(
            name="Follow Builders",
            source_type="follow_builders",
            url="",
            enabled=True,
        )
        db.add(fb_source)
        db.commit()
        db.refresh(fb_source)

    items: list[NewsItem] = []
    # follow-builders 的 feed 由仓库维护者定期更新，内容本身已是近期数据。
    # 不做时间截止过滤，依靠 external_id 去重避免重复入库。

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            # X feed
            try:
                resp = client.get(_FB_FEEDS["x"])
                if resp.status_code == 200:
                    data = resp.json()
                    for builder in data.get("x", []):
                        name = builder.get("name", "")
                        handle = builder.get("handle", "")
                        for tw in builder.get("tweets", []):
                            pub_at = _parse_iso(tw.get("createdAt"))
                            ext_id = f"fb_x:{tw.get('id', '')}"
                            metrics = {
                                "likes": tw.get("likes", 0),
                                "retweets": tw.get("retweets", 0),
                                "replies": tw.get("replies", 0),
                            }
                            tweet_text = tw.get("text", "")
                            tweet_id = tw.get("id", "")
                            # 通过 vxtwitter 获取媒体图片，追加到内容末尾
                            if tweet_id and handle:
                                img_urls = _get_tweet_media(handle, tweet_id, client)
                                if img_urls:
                                    tweet_text = tweet_text + "\n" + "\n".join(img_urls)
                            item = _save_item(
                                db,
                                source_id=fb_source.id,
                                title=f"{name} (@{handle})",
                                content=tweet_text,
                                original_url=tw.get("url", ""),
                                author=name,
                                published_at=pub_at,
                                item_type="tweet",
                                metadata_json=json.dumps(metrics),
                                external_id=ext_id,
                            )
                            if item:
                                items.append(item)
            except Exception:
                logger.exception("Failed to fetch follow-builders X feed")

            # Podcasts feed
            try:
                resp = client.get(_FB_FEEDS["podcasts"])
                if resp.status_code == 200:
                    data = resp.json()
                    for pod in data.get("podcasts", []):
                        pub_at = _parse_iso(pod.get("publishedAt"))
                        ext_id = f"fb_pod:{pod.get('guid', pod.get('title', ''))}"
                        item = _save_item(
                            db,
                            source_id=fb_source.id,
                            title=f"{pod.get('name', '')}: {pod.get('title', '')}",
                            content=pod.get("transcript", ""),
                            original_url=pod.get("url", ""),
                            author=pod.get("name", ""),
                            published_at=pub_at,
                            item_type="podcast",
                            external_id=ext_id,
                        )
                        if item:
                            items.append(item)
            except Exception:
                logger.exception("Failed to fetch follow-builders podcasts feed")

            # Blogs feed
            try:
                resp = client.get(_FB_FEEDS["blogs"])
                if resp.status_code == 200:
                    data = resp.json()
                    for blog in data.get("blogs", []):
                        pub_at = _parse_iso(blog.get("publishedAt"))
                        ext_id = f"fb_blog:{blog.get('url', blog.get('title', ''))}"
                        item = _save_item(
                            db,
                            source_id=fb_source.id,
                            title=blog.get("title", ""),
                            content=blog.get("content", ""),
                            original_url=blog.get("url", ""),
                            author=blog.get("author", blog.get("name", "")),
                            published_at=pub_at,
                            item_type="blog_post",
                            external_id=ext_id,
                        )
                        if item:
                            items.append(item)
            except Exception:
                logger.exception("Failed to fetch follow-builders blogs feed")

    except Exception:
        logger.exception("Failed to fetch follow-builders feeds")

    # 更新源的 last_fetch_at
    fb_source.last_fetch_at = dt.datetime.utcnow()
    db.commit()

    return items


# ============================================================
# 总入口：按来源类型分派
# ============================================================

_FETCHERS = {
    "x_account": fetch_x_account,
    "rss": fetch_rss,
    "blog": fetch_blog,
}


def fetch_source(source: NewsSource, lookback_hours: int, db) -> list[NewsItem]:
    """抓取单个源的新内容。"""
    fetcher = _FETCHERS.get(source.source_type)
    if not fetcher:
        logger.warning("Unknown source type: %s", source.source_type)
        return []
    items = fetcher(source, lookback_hours, db)
    source.last_fetch_at = dt.datetime.utcnow()
    db.commit()
    return items


def fetch_all(lookback_hours: int = 24, include_follow_builders: bool = True) -> int:
    """抓取所有启用的源，返回新条目总数。"""
    db = SessionLocal()
    total = 0
    try:
        sources = db.query(NewsSource).filter_by(enabled=True).all()
        for src in sources:
            if src.source_type == "follow_builders":
                continue  # 单独处理
            try:
                items = fetch_source(src, lookback_hours, db)
                total += len(items)
                logger.info("Fetched %d items from %s (%s)", len(items), src.name, src.source_type)
            except Exception:
                logger.exception("Error fetching source %s", src.name)

        if include_follow_builders:
            try:
                items = fetch_follow_builders(lookback_hours, db)
                total += len(items)
                logger.info("Fetched %d items from follow-builders", len(items))
            except Exception:
                logger.exception("Error fetching follow-builders")

    finally:
        db.close()

    return total
