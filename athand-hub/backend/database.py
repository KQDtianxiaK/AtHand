from __future__ import annotations

from sqlalchemy import create_engine
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """创建所有表（开发用）。生产环境用 alembic 迁移。"""
    import models  # noqa: F401 — 确保模型被加载

    Base.metadata.create_all(bind=engine)
    print("✅ 数据库表已创建")


if __name__ == "__main__":
    init_db()
