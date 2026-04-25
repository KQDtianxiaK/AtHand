"""
新闻每日总结生成服务。
收集一天的 NewsItem，调用 AI 生成 Markdown 格式的总结文稿。
"""
from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from openai import OpenAI
from sqlalchemy.orm import Session

from models import NewsDigest, NewsItem, NewsSettings, NewsSource

logger = logging.getLogger("news_digest")

_SETTINGS_FILE = Path(__file__).parent.parent / "data" / "ai_settings.json"

# ---- 默认总结 prompt ----
DEFAULT_DIGEST_PROMPT = """你是一名专业的每日新闻总结编辑。请将以下信息源的内容整理成一份简明扼要的中文日报。

## 格式要求

标题格式: **AI 资讯日报 — {date}**

按以下顺序组织内容（仅包含有新内容的板块）:

### 📱 X/Twitter 动态
- 对每位有实质内容的作者：用全名介绍 + 2-4 句概括其关键观点
- 跳过无实质内容的推文
- 附上原推链接

### 📝 博客文章
- 以博客名+文章标题为小标题
- 100-300 字摘要核心内容
- 包含具体数据和实际影响
- 附上原文链接

### 🎙️ 播客
- 一句话核心要点
- 200-400 字摘要（含嘉宾介绍、关键洞察、原文引用）
- 附上收听链接

## 规则
- 仅使用提供的素材，不要编造任何内容
- 如果某个板块没有内容，完全跳过不提
- 每条内容必须附上原文链接
- 保持语气专业但不枯燥，像一位聪明的同事帮你划重点
- 最后一行加上: "共收录 {item_count} 条资讯"

## 🏛️ 史官点评

在全文**最后**，必须依次写出以下两段，不得省略：

1. **幽默解说**：用诙谐、吐槽的语气，总结今日/昨日都发生了哪些大事，像一位说脱口秀的科技博主在点评。
2. **史官视角**：以一位"已知过去与未来、站在历史终点回望"的史学家角度，用现代语言评价这一天的意义——这位史官清楚地知道这些事件之后会发生什么、对历史走向有何影响，语气睿智且带一点调侃，像在写一部几百年后出版的历史教科书注脚。
"""


def _load_ai_settings() -> dict:
    if _SETTINGS_FILE.exists():
        return json.loads(_SETTINGS_FILE.read_text())
    return {}


def _get_settings(db: Session) -> NewsSettings:
    s = db.query(NewsSettings).first()
    if not s:
        s = NewsSettings(id=1)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _build_source_material(items: list[NewsItem]) -> str:
    """将新闻条目按类型分组，组装成 AI 输入素材。"""
    groups: dict[str, list[str]] = {
        "tweet": [],
        "blog_post": [],
        "podcast": [],
        "article": [],
    }

    for item in items:
        t = item.item_type
        if t not in groups:
            t = "article"

        entry = f"标题: {item.title}\n"
        entry += f"作者: {item.author}\n"
        entry += f"链接: {item.original_url}\n"
        if item.published_at:
            entry += f"时间: {item.published_at.strftime('%Y-%m-%d %H:%M')}\n"

        # 对内容选择摘要或原文
        if item.summary:
            entry += f"摘要:\n{item.summary}\n"
        elif item.content:
            # 截断长内容
            content = item.content[:2000]
            if len(item.content) > 2000:
                content += "...(已截断)"
            entry += f"内容:\n{content}\n"

        # 对推文加上元数据
        if t == "tweet" and item.metadata_json:
            try:
                meta = json.loads(item.metadata_json)
                if meta.get("likes"):
                    entry += f"互动: {meta.get('likes', 0)} 赞 / {meta.get('retweets', 0)} 转\n"
            except (json.JSONDecodeError, TypeError):
                pass

        groups[t].append(entry)

    sections = []
    if groups["tweet"]:
        sections.append("## X/Twitter 推文\n\n" + "\n---\n".join(groups["tweet"]))
    if groups["blog_post"]:
        sections.append("## 博客文章\n\n" + "\n---\n".join(groups["blog_post"]))
    if groups["podcast"]:
        sections.append("## 播客\n\n" + "\n---\n".join(groups["podcast"]))
    if groups["article"]:
        sections.append("## RSS/文章\n\n" + "\n---\n".join(groups["article"]))

    return "\n\n".join(sections)


def generate_digest(
    db: Session,
    target_date: dt.date | None = None,
    force: bool = False,
    digest_type: str = "daily",
) -> NewsDigest | None:
    """为指定日期生成新闻总结。force=True 时强制重新生成。
    digest_type: 'daily'=定时昨日总结, 'today'=手动今日速览
    """
    if target_date is None:
        target_date = dt.date.today()

    settings = _get_settings(db)

    # 检查是否已存在该日+类型总结（非强制模式下跳过）
    existing = (
        db.query(NewsDigest)
        .filter_by(date=target_date, digest_type=digest_type)
        .first()
    )
    if existing and existing.status == "ready" and not force:
        logger.info("Digest for %s/%s already exists", target_date, digest_type)
        return existing

    # 获取当日新闻条目 —— 只包含当前启用信息源的条目
    day_start = dt.datetime.combine(target_date, dt.time.min)
    day_end = dt.datetime.combine(target_date + dt.timedelta(days=1), dt.time.min)

    items = (
        db.query(NewsItem)
        .join(NewsSource, NewsItem.source_id == NewsSource.id)
        .filter(
            NewsSource.enabled == True,
            NewsItem.fetched_at >= day_start,
            NewsItem.fetched_at < day_end,
        )
        .order_by(NewsItem.published_at.desc())
        .all()
    )

    if not items:
        logger.info("No items for %s, skipping digest", target_date)
        return None

    # 创建或更新 digest 记录
    digest = existing or NewsDigest(date=target_date, digest_type=digest_type)
    digest.status = "generating"
    digest.item_count = len(items)
    if not existing:
        db.add(digest)
    db.commit()
    db.refresh(digest)

    # 组装素材
    material = _build_source_material(items)

    # 获取 AI 设置
    ai_s = _load_ai_settings()
    api_base = ai_s.get("api_base", "")
    api_key = ai_s.get("api_key", "")
    model = ai_s.get("model", "")

    if not api_base or not api_key or not model:
        digest.status = "failed"
        digest.content = "AI 设置未配置，无法生成总结。"
        db.commit()
        return digest

    # 构建 prompt
    prompt = settings.digest_prompt or DEFAULT_DIGEST_PROMPT
    prompt = prompt.replace("{date}", target_date.strftime("%Y年%m月%d日"))
    prompt = prompt.replace("{item_count}", str(len(items)))

    try:
        client = OpenAI(base_url=api_base, api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": material},
            ],
            max_tokens=4000,
            temperature=0.4,
        )
        content = resp.choices[0].message.content or ""

        type_label = "今日速览" if digest_type == "today" else "AI 资讯日报"
        digest.title = f"{type_label} — {target_date.strftime('%Y年%m月%d日')}"
        digest.content = content
        digest.prompt_used = prompt[:500]
        digest.status = "ready"
        digest.is_read = False
        digest.generated_at = dt.datetime.utcnow()
        db.commit()
        logger.info("Generated digest for %s with %d items", target_date, len(items))
        return digest

    except Exception:
        logger.exception("Failed to generate digest for %s", target_date)
        digest.status = "failed"
        db.commit()
        return digest
