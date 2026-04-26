"""
Agent Daemon：WebSocket 客户端守护进程。
连接 ECS 后端，接收任务指令，调用 Kimi Code，回传结果。
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

import yaml

try:
    import websockets
    from websockets.asyncio.client import connect as ws_connect
except ImportError:
    print("请安装依赖: pip install -r requirements.txt")
    sys.exit(1)

from system_info import get_system_info
from news_handler import NewsClient, handle_news_message

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("daemon")

# ---- 加载配置 ----
config_path = Path(__file__).parent / "config.yaml"
if not config_path.exists():
    print(f"❌ 配置文件不存在: {config_path}")
    print(f"   请复制 config.example.yaml 为 config.yaml 并修改")
    sys.exit(1)

with open(config_path) as f:
    config = yaml.safe_load(f)

HUB_URL = config["hub_url"]
MACHINE_ID = config["machine_id"]
AGENT_TOKEN = config["agent_token"]
HEARTBEAT_INTERVAL = config.get("heartbeat_interval", 30)
ADMIN_PASSWORD = config.get("admin_password", "admin123")

# 新闻 API 客户端（共享实例以复用 JWT token）
_news_client = NewsClient(hub_url=HUB_URL, admin_password=ADMIN_PASSWORD)


async def handle_message(ws, data: dict):
    """处理从 Hub 收到的消息。"""
    msg_type = data.get("type", "")

    if msg_type in (
        "news_get_stats", "news_get_items", "news_fetch",
        "news_get_digest", "news_get_digests", "news_generate_digest",
        "news_mark_read",
        "news_get_sources", "news_add_source", "news_update_source", "news_delete_source",
        "news_get_settings", "news_update_settings",
    ):
        await handle_news_message(ws, data, _news_client)

    else:
        logger.warning("未知消息类型: %s", msg_type)


async def heartbeat_loop(ws):
    """定期发送心跳 + 系统信息。"""
    while True:
        try:
            info = get_system_info()
            await ws.send(json.dumps({"type": "heartbeat"}))
            await ws.send(json.dumps({"type": "system_info", "info": info}))
        except Exception:
            break
        await asyncio.sleep(HEARTBEAT_INTERVAL)


async def run():
    url = f"{HUB_URL}/{MACHINE_ID}?token={AGENT_TOKEN}"
    retry_delay = 2  # 初始重连延迟（秒）
    max_delay = 60

    while True:
        try:
            logger.info("连接 Hub: %s", HUB_URL)
            # 禁用 websockets 库自动 ping，避免与 Starlette WebSocket 不兼容导致断连
            # 我们已有应用层心跳机制
            async with ws_connect(
                url,
                ping_interval=None,
                close_timeout=10,
            ) as ws:
                logger.info("✅ 已连接 Hub (机器: %s)", MACHINE_ID)
                retry_delay = 2  # 重置延迟

                # 启动心跳协程
                heartbeat_task = asyncio.create_task(heartbeat_loop(ws))

                try:
                    async for raw in ws:
                        data = json.loads(raw)
                        # 每个任务在独立的 task 中处理，避免阻塞消息循环
                        asyncio.create_task(handle_message(ws, data))
                except websockets.exceptions.ConnectionClosed:
                    logger.warning("连接已断开")
                finally:
                    heartbeat_task.cancel()

        except (OSError, websockets.exceptions.WebSocketException) as e:
            logger.warning("连接失败: %s，%ds 后重试", e, retry_delay)

        await asyncio.sleep(retry_delay)
        retry_delay = min(retry_delay * 2, max_delay)  # 指数退避


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Agent Daemon 已停止")
