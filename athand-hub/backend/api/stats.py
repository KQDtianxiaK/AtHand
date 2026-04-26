from __future__ import annotations

import logging
import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import ClockRecord, Machine
from services.ai_control_bridge import bridge_service

logger = logging.getLogger("api.stats")

DONE_STATUSES = {"done", "completed", "cancelled", "canceled", "finished", "stopped", "closed", "archived"}
ERROR_STATUSES = {"failed", "error", "crashed", "timed_out", "timeout"}

router = APIRouter(prefix="/api/stats", tags=["stats"], dependencies=[Depends(get_current_user)])


def _normalize_status(value: str | None) -> str:
    return (value or "").strip().lower().replace("-", "_").replace(" ", "_")


def _deduped_history_representative_machine_ids(db: Session) -> list[str]:
    machine_ids: list[str] = []
    seen_daemon_urls: set[str] = set()
    machines = db.query(Machine).order_by(Machine.name).all()
    for machine in machines:
        daemon_url = bridge_service._daemon_url_for_machine(machine.id)
        if not daemon_url or daemon_url in seen_daemon_urls:
            continue
        seen_daemon_urls.add(daemon_url)
        machine_ids.append(machine.id)
    return machine_ids


def _collect_deduped_bridge_history(db: Session) -> list:
    items_by_agent_id = {}

    for machine_id in _deduped_history_representative_machine_ids(db):
        cursor: str | None = None
        page_count = 0

        while True:
            try:
                response = bridge_service.get_history(
                    machine_id=machine_id,
                    provider=None,
                    status=None,
                    cursor=cursor,
                    limit=200,
                    db=db,
                )
            except Exception as exc:
                logger.warning("Failed to fetch bridge history for stats", exc_info=exc)
                break

            for item in response.items:
                existing = items_by_agent_id.get(item.agent_id)
                if existing is None or item.updated_at > existing.updated_at:
                    items_by_agent_id[item.agent_id] = item

            if not response.next_cursor:
                break

            cursor = response.next_cursor
            page_count += 1
            if page_count >= 100:
                logger.warning("Stats bridge history pagination hit page cap", extra={"machine_id": machine_id})
                break

    return list(items_by_agent_id.values())


def _is_done(item) -> bool:
    if item.attention_reason == "error":
        return False
    return item.attention_reason == "finished" or _normalize_status(item.status) in DONE_STATUSES


def _is_failed(item) -> bool:
    return item.attention_reason == "error" or _normalize_status(item.status) in ERROR_STATUSES


def build_stats_overview(days: int, db: Session):
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    history_items = _collect_deduped_bridge_history(db)
    recent_items = [item for item in history_items if item.created_at >= since]

    total_sessions = len(recent_items)
    done_sessions = sum(1 for item in recent_items if _is_done(item))
    failed_sessions = sum(1 for item in recent_items if _is_failed(item))

    daily_session_counts: dict[str, int] = defaultdict(int)
    machine_session_counts: dict[str, int] = defaultdict(int)
    for item in recent_items:
        daily_session_counts[str(item.created_at.date())] += 1
        machine_session_counts[item.machine_id] += 1

    # 工时统计（含分段）
    clock_records = (
        db.query(ClockRecord)
        .filter(ClockRecord.clock_in >= since, ClockRecord.clock_out.isnot(None))
        .all()
    )
    total_hours = sum(
        (r.clock_out - r.clock_in).total_seconds() / 3600 for r in clock_records
    )

    # 每日分段工时：[{ day, morning, afternoon, evening, total }]
    # 按本地日期归组（以 UTC 日期近似，前端也统一）
    daily_hours_map: dict[str, dict[str, float]] = {}
    for r in clock_records:
        day = str(r.clock_in.date())
        if day not in daily_hours_map:
            daily_hours_map[day] = {"morning": 0.0, "afternoon": 0.0, "evening": 0.0}
        h = (r.clock_out - r.clock_in).total_seconds() / 3600
        period = r.period or "morning"
        daily_hours_map[day][period] = daily_hours_map[day].get(period, 0.0) + h

    # 补全最近 days 天，确保每天都有数据点
    today = dt.date.today()
    daily_work_hours = []
    for i in range(days - 1, -1, -1):
        d = str(today - dt.timedelta(days=i))
        seg = daily_hours_map.get(d, {"morning": 0.0, "afternoon": 0.0, "evening": 0.0})
        daily_work_hours.append({
            "day": d,
            "morning": round(seg.get("morning", 0.0), 2),
            "afternoon": round(seg.get("afternoon", 0.0), 2),
            "evening": round(seg.get("evening", 0.0), 2),
            "total": round(seg.get("morning", 0.0) + seg.get("afternoon", 0.0) + seg.get("evening", 0.0), 2),
        })

    return {
        "total_sessions": total_sessions,
        "done_sessions": done_sessions,
        "failed_sessions": failed_sessions,
        "success_rate": round(done_sessions / total_sessions * 100, 1) if total_sessions else 0,
        "daily_sessions": [
            {"day": day, "count": count}
            for day, count in sorted(daily_session_counts.items())
        ],
        "machine_sessions": [
            {"machine_id": machine_id, "count": count}
            for machine_id, count in sorted(machine_session_counts.items())
        ],
        # Temporary aliases for compatibility with older callers.
        "total_tasks": total_sessions,
        "done_tasks": done_sessions,
        "failed_tasks": failed_sessions,
        "daily_tasks": [
            {"day": day, "count": count}
            for day, count in sorted(daily_session_counts.items())
        ],
        "machine_tasks": [
            {"machine_id": machine_id, "count": count}
            for machine_id, count in sorted(machine_session_counts.items())
        ],
        "total_work_hours": round(total_hours, 1),
        "daily_work_hours": daily_work_hours,
    }


@router.get("/overview")
def overview(days: int = 7, db: Session = Depends(get_db)):
    return build_stats_overview(days=days, db=db)
