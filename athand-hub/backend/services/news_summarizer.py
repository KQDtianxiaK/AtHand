"""
新闻 AI 摘要服务 —— 对长文内容生成摘要，复用 AtHand 现有 AI 设置。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from openai import OpenAI

logger = logging.getLogger("news_summarizer")

_SETTINGS_FILE = Path(__file__).parent.parent / "data" / "ai_settings.json"

# 摘要阈值：低于此字数不摘要
SUMMARY_THRESHOLD = 500

# ---- Prompt 模板 ----

TWEET_SUMMARY_PROMPT = """你是一名信息摘要助手。以下是来自 Twitter/X 的帖子内容。
请用简洁中文概括核心观点，2-4 句话。如果帖子已经很短，直接翻译/转述即可。
不要加"这条推文讲了..."之类的前缀，直接说内容。"""

BLOG_SUMMARY_PROMPT = """你是一名信息摘要助手。以下是一篇博客文章的内容。
请用中文生成 100-300 字的摘要：
- 直接说核心发现/公告/洞察
- 如有具体数字、基准测试、结果，请包含
- 如有实际影响（新 API、新功能、政策变化），请指出
- 不要用"本文讲述了..."之类的开头
- 保持信息密度高、语气专业简洁"""

PODCAST_SUMMARY_PROMPT = """你是一名信息摘要助手。以下是一期播客的文字记录。
请用中文生成 200-400 字的摘要：
- 以一句话"核心要点"开头
- 介绍嘉宾背景和为什么值得关注
- 优先提取反直觉、独特、有新意的洞察
- 至少包含一句原文引用
- 不要用"这期节目..."的说法，直接提取知识和观点
- 保持语气犀利、对话感"""

ARTICLE_SUMMARY_PROMPT = """你是一名信息摘要助手。以下是一篇文章的内容。
请用中文生成简洁摘要（100-300 字）：
- 直接说核心内容
- 保持信息密度
- 语气专业简洁"""


def _load_ai_settings() -> dict:
    """加载 AI 设置。"""
    if _SETTINGS_FILE.exists():
        return json.loads(_SETTINGS_FILE.read_text())
    return {}


def _get_client() -> tuple[OpenAI, str] | None:
    """获取 OpenAI 客户端和模型名。"""
    s = _load_ai_settings()
    api_base = s.get("api_base", "")
    api_key = s.get("api_key", "")
    model = s.get("model", "")
    if not api_base or not api_key or not model:
        logger.warning("AI settings not configured, cannot summarize")
        return None
    client = OpenAI(base_url=api_base, api_key=api_key)
    return client, model


_TYPE_PROMPTS = {
    "tweet": TWEET_SUMMARY_PROMPT,
    "blog_post": BLOG_SUMMARY_PROMPT,
    "podcast": PODCAST_SUMMARY_PROMPT,
    "article": ARTICLE_SUMMARY_PROMPT,
}


def summarize_content(content: str, item_type: str = "article", title: str = "") -> str:
    """对单条内容生成 AI 摘要。内容短于阈值则返回空字符串。"""
    if len(content) < SUMMARY_THRESHOLD:
        return ""

    result = _get_client()
    if result is None:
        return ""
    client, model = result

    system_prompt = _TYPE_PROMPTS.get(item_type, ARTICLE_SUMMARY_PROMPT)
    user_msg = content[:8000]  # 限制输入长度
    if title:
        user_msg = f"标题: {title}\n\n{user_msg}"

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=800,
            temperature=0.3,
        )
        return resp.choices[0].message.content or ""
    except Exception:
        logger.exception("Failed to summarize content")
        return ""


def summarize_new_items(db) -> int:
    """对所有没有摘要的长文条目生成摘要。返回处理条数。"""
    from models import NewsItem

    items = db.query(NewsItem).filter(
        NewsItem.summary == "",
        NewsItem.content != "",
    ).all()

    count = 0
    for item in items:
        if len(item.content) < SUMMARY_THRESHOLD:
            continue
        summary = summarize_content(item.content, item.item_type, item.title)
        if summary:
            item.summary = summary
            db.commit()
            count += 1
            logger.info("Summarized item #%d: %s", item.id, item.title[:50])

    return count
