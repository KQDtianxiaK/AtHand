from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # SQLite 需要
    echo=False,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


LEGACY_TABLES = ("messages", "tasks")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _drop_legacy_tables() -> list[str]:
    existing_tables = set(inspect(engine).get_table_names())
    stale_tables = [table_name for table_name in LEGACY_TABLES if table_name in existing_tables]
    if not stale_tables:
        return []

    with engine.begin() as connection:
        for table_name in stale_tables:
            connection.execute(text(f'DROP TABLE IF EXISTS "{table_name}"'))

    return stale_tables


def init_db():
    """创建所有表（开发用）。生产环境用 alembic 迁移。"""
    import models  # noqa: F401 — 确保模型被加载

    dropped_tables = _drop_legacy_tables()
    Base.metadata.create_all(bind=engine)
    if dropped_tables:
        print(f"🧹 已移除旧表: {', '.join(dropped_tables)}")
    print("✅ 数据库表已创建")


if __name__ == "__main__":
    init_db()
