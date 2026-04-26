from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import ClockRecord, Task

router = APIRouter(prefix="/api/stats", tags=["stats"], dependencies=[Depends(get_current_user)])


def build_stats_overview(days: int, db: Session):
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)

    total_tasks = db.query(func.count(Task.id)).filter(Task.created_at >= since).scalar()
    done_tasks = db.query(func.count(Task.id)).filter(
        Task.created_at >= since, Task.status == "done"
    ).scalar()
    failed_tasks = db.query(func.count(Task.id)).filter(
        Task.created_at >= since, Task.status == "failed"
    ).scalar()

    # 每日任务数
    daily_tasks = (
        db.query(func.date(Task.created_at).label("day"), func.count(Task.id).label("count"))
        .filter(Task.created_at >= since)
        .group_by(func.date(Task.created_at))
        .all()
    )

    # 各机器任务数
    machine_tasks = (
        db.query(Task.machine_id, func.count(Task.id).label("count"))
        .filter(Task.created_at >= since)
        .group_by(Task.machine_id)
        .all()
    )

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
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "failed_tasks": failed_tasks,
        "success_rate": round(done_tasks / total_tasks * 100, 1) if total_tasks else 0,
        "daily_tasks": [{"day": str(d.day), "count": d.count} for d in daily_tasks],
        "machine_tasks": [{"machine_id": m.machine_id, "count": m.count} for m in machine_tasks],
        "total_work_hours": round(total_hours, 1),
        "daily_work_hours": daily_work_hours,
    }


@router.get("/overview")
def overview(days: int = 7, db: Session = Depends(get_db)):
    return build_stats_overview(days=days, db=db)
