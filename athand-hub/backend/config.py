from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings

# 项目根目录（backend/ 的上级）
ROOT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # JWT
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 天

    # 管理员
    admin_password: str = "admin123"

    # 数据库
    database_url: str = "sqlite:///./data/athand.db"
    data_dir: str = "./data"

    # Agent Daemon 预共享 token
    agent_token: str = "change-me"

    # 后端端口
    backend_port: int = 8000

    # AI 助手（可通过 /api/assistant/settings 在前端动态配置）
    ai_api_base: str = ""      # 例如 https://api.deepseek.com/v1
    ai_api_key: str = ""
    ai_model: str = ""         # 例如 deepseek-chat

    # AI 管控 bridge（Phase 1 paseo sidecar 骨架）
    ai_control_default_daemon_url: str = ""
    ai_control_default_client_id: str = "athand-backend"
    ai_control_machine_daemons: str = ""

    model_config = {"env_file": str(ROOT_DIR / ".env"), "extra": "ignore"}


settings = Settings()

# 确保数据目录存在
data_path = Path(settings.data_dir)
data_path.mkdir(parents=True, exist_ok=True)
