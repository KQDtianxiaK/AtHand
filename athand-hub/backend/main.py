"""
FastAPI 主入口。
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import settings
from database import init_db

# ---- 初始化数据库 ----
init_db()


class SPAStaticFiles(StaticFiles):
    @staticmethod
    def _should_fallback_to_index(path: str) -> bool:
        clean_path = path.lstrip("/")
        if clean_path.startswith(("api/", "ws/")):
            return False
        return not Path(clean_path).suffix

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or not self._should_fallback_to_index(path):
                raise
            return await super().get_response("index.html", scope)

        if response.status_code == 404 and self._should_fallback_to_index(path):
            return await super().get_response("index.html", scope)
        return response

app = FastAPI(title="AtHand Hub", version="0.1.0")

# ---- CORS（开发时允许前端 dev server 跨域）----
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- 注册路由 ----
from api.auth import router as auth_router
from api.memos import router as memos_router
from api.todos import router as todos_router
from api.clock import router as clock_router
from api.stats import router as stats_router
from api.assistant import router as assistant_router
from api.ai_control import router as ai_control_router
from api.email import router as email_router
from api.news import router as news_router
from ws.hub import router as ws_router

app.include_router(auth_router)
app.include_router(memos_router)
app.include_router(todos_router)
app.include_router(clock_router)
app.include_router(stats_router)
app.include_router(assistant_router)
app.include_router(ai_control_router)
app.include_router(email_router)
app.include_router(news_router)
app.include_router(ws_router)


@app.on_event("startup")
async def _start_email_scheduler():
    from services.email_scheduler import start_scheduler
    start_scheduler()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
async def _start_news_scheduler():
    from services.news_scheduler import start_scheduler
    start_scheduler()

# ---- 静态文件：serve 前端构建产物 ----
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", SPAStaticFiles(directory=str(frontend_dist), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        ws_ping_interval=None,
        ws_ping_timeout=None,
    )
