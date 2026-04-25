"""
新闻功能 HTTP 客户端 —— 供 AI 助手通过 WebSocket 调用后端 News API。

支持的消息类型（与 daemon.py 一起使用）：
  news_get_stats       → GET  /api/news/stats
  news_get_items       → GET  /api/news/items        (可选: date, item_type, source_type, page_size)
  news_fetch           → POST /api/news/fetch
  news_get_digest      → GET  /api/news/digests/latest
  news_get_digests     → GET  /api/news/digests      (可选: limit)
  news_generate_digest → POST /api/news/digests/generate
  news_mark_read       → PUT  /api/news/items/{id}/read
  news_get_sources     → GET  /api/news/sources
  news_add_source      → POST /api/news/sources
  news_update_source   → PUT  /api/news/sources/{id}
  news_delete_source   → DELETE /api/news/sources/{id}
  news_get_settings    → GET  /api/news/settings
  news_update_settings → PUT  /api/news/settings
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("news_handler")


class NewsClient:
    """封装后端 /api/news/* 接口调用，自动处理 JWT 认证（token 过期自动重登录）。"""

    def __init__(self, hub_url: str, admin_password: str):
        # 从 WebSocket URL 推导 HTTP base URL
        # ws://localhost:8000/ws/agent -> http://localhost:8000
        parsed = urlparse(hub_url)
        scheme = "https" if parsed.scheme == "wss" else "http"
        self._base = f"{scheme}://{parsed.netloc}"
        self._password = admin_password
        self._token: str | None = None

    async def _ensure_token(self) -> str:
        """确保持有有效 JWT token，必要时向后端登录。"""
        if self._token:
            return self._token
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/api/auth/login/json",
                json={"password": self._password},
            )
            resp.raise_for_status()
            self._token = resp.json()["access_token"]
            logger.info("新闻客户端已获取 JWT token")
        return self._token

    async def _request(self, method: str, path: str, *,
                       params: dict | None = None,
                       body: dict | None = None) -> dict | list | None:
        """带自动 401 重试的通用 HTTP 请求。"""
        for attempt in range(2):
            token = await self._ensure_token()
            headers = {"Authorization": f"Bearer {token}"}
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.request(
                    method,
                    f"{self._base}{path}",
                    params=params,
                    json=body,
                    headers=headers,
                )
            if resp.status_code == 401 and attempt == 0:
                # token 过期，清除后重试
                self._token = None
                continue
            resp.raise_for_status()
            # 204 No Content 或空体
            if resp.status_code == 204 or not resp.content:
                return {"ok": True}
            return resp.json()
        return {"error": "认证失败"}

    # ---- 统计 ----
    async def get_stats(self) -> dict:
        return await self._request("GET", "/api/news/stats")

    # ---- 新闻条目 ----
    async def get_items(self, date: str | None = None,
                        item_type: str | None = None,
                        source_type: str | None = None,
                        is_read: bool | None = None,
                        page_size: int = 50) -> list:
        params: dict = {"page_size": page_size}
        if date:
            params["date"] = date
        if item_type:
            params["item_type"] = item_type
        if source_type:
            params["source_type"] = source_type
        if is_read is not None:
            params["is_read"] = str(is_read).lower()
        return await self._request("GET", "/api/news/items", params=params)

    async def mark_item_read(self, item_id: int) -> dict:
        return await self._request("PUT", f"/api/news/items/{item_id}/read")

    # ---- 抓取 ----
    async def trigger_fetch(self) -> dict:
        return await self._request("POST", "/api/news/fetch")

    # ---- 每日总结 ----
    async def get_latest_digest(self) -> dict | None:
        return await self._request("GET", "/api/news/digests/latest")

    async def get_digests(self, limit: int = 30) -> list:
        return await self._request("GET", "/api/news/digests", params={"limit": limit})

    async def generate_digest(self) -> dict:
        return await self._request("POST", "/api/news/digests/generate")

    # ---- 信息源 ----
    async def get_sources(self) -> list:
        return await self._request("GET", "/api/news/sources")

    async def add_source(self, name: str, source_type: str, url: str = "",
                         category: str = "", enabled: bool = True,
                         api_key: str = "", config_json: str = "{}") -> dict:
        return await self._request("POST", "/api/news/sources", body={
            "name": name, "source_type": source_type, "url": url,
            "category": category, "enabled": enabled,
            "api_key": api_key, "config_json": config_json,
        })

    async def update_source(self, source_id: int, **kwargs) -> dict:
        return await self._request("PUT", f"/api/news/sources/{source_id}", body=kwargs)

    async def delete_source(self, source_id: int) -> dict:
        return await self._request("DELETE", f"/api/news/sources/{source_id}")

    # ---- 设置 ----
    async def get_settings(self) -> dict:
        return await self._request("GET", "/api/news/settings")

    async def update_settings(self, **kwargs) -> dict:
        return await self._request("PUT", "/api/news/settings", body=kwargs)


async def handle_news_message(ws, data: dict, client: NewsClient):
    """
    统一入口：根据消息 type 分发到对应的 NewsClient 方法，
    并将结果以 {type: response, req_id, data} 格式回传。
    """
    import json
    import websockets

    msg_type = data.get("type", "")
    req_id = data.get("req_id")

    try:
        result: dict | list | None = None

        if msg_type == "news_get_stats":
            result = await client.get_stats()

        elif msg_type == "news_get_items":
            result = await client.get_items(
                date=data.get("date"),
                item_type=data.get("item_type"),
                source_type=data.get("source_type"),
                is_read=data.get("is_read"),
                page_size=data.get("page_size", 50),
            )

        elif msg_type == "news_fetch":
            result = await client.trigger_fetch()

        elif msg_type == "news_get_digest":
            result = await client.get_latest_digest()

        elif msg_type == "news_get_digests":
            result = await client.get_digests(limit=data.get("limit", 30))

        elif msg_type == "news_generate_digest":
            result = await client.generate_digest()

        elif msg_type == "news_mark_read":
            result = await client.mark_item_read(data["item_id"])

        elif msg_type == "news_get_sources":
            result = await client.get_sources()

        elif msg_type == "news_add_source":
            result = await client.add_source(
                name=data["name"],
                source_type=data["source_type"],
                url=data.get("url", ""),
                category=data.get("category", ""),
                enabled=data.get("enabled", True),
                api_key=data.get("api_key", ""),
                config_json=data.get("config_json", "{}"),
            )

        elif msg_type == "news_update_source":
            kwargs = {k: v for k, v in data.items()
                      if k not in ("type", "req_id", "source_id")}
            result = await client.update_source(data["source_id"], **kwargs)

        elif msg_type == "news_delete_source":
            result = await client.delete_source(data["source_id"])

        elif msg_type == "news_get_settings":
            result = await client.get_settings()

        elif msg_type == "news_update_settings":
            kwargs = {k: v for k, v in data.items()
                      if k not in ("type", "req_id")}
            result = await client.update_settings(**kwargs)

        await ws.send(json.dumps({
            "type": "response",
            "req_id": req_id,
            "data": result,
        }))

    except httpx.HTTPStatusError as e:
        logger.error("新闻 API 请求失败: %s %s", e.response.status_code, msg_type)
        try:
            await ws.send(json.dumps({
                "type": "response",
                "req_id": req_id,
                "data": {"error": f"HTTP {e.response.status_code}: {e.response.text[:200]}"},
            }))
        except websockets.exceptions.ConnectionClosed:
            pass

    except Exception as e:
        logger.exception("处理新闻消息 %s 时出错", msg_type)
        try:
            await ws.send(json.dumps({
                "type": "response",
                "req_id": req_id,
                "data": {"error": str(e)},
            }))
        except websockets.exceptions.ConnectionClosed:
            pass
