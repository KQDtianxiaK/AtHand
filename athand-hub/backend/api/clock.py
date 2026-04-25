from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import ClockRecord

router = APIRouter(prefix="/api/clock", tags=["clock"], dependencies=[Depends(get_current_user)])

PERIODS = ("morning", "afternoon", "evening")


class ClockOut(BaseModel):
    id: int
    clock_in: dt.datetime
    clock_out: dt.datetime | None
    note: str
    period: str
    created_at: dt.datetime

    model_config = {"from_attributes": True}


class ClockInBody(BaseModel):
    note: str = ""
    period: str = "morning"  # morning | afternoon | evening
    clock_time: str | None = None  # ISO 8601，用于补卡（不传则取当前时间）


def _parse_clock_time(clock_time: str | None) -> dt.datetime:
    """将前端传来的 ISO 字符串转为 UTC naive datetime；不传则用当前时间。"""
    if not clock_time:
        return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    try:
        ts = dt.datetime.fromisoformat(clock_time)
        if ts.tzinfo is not None:
            ts = ts.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return ts
    except ValueError:
        raise HTTPException(400, "clock_time 格式错误，需 ISO 8601")


@router.post("/in", response_model=ClockOut)
def clock_in(body: ClockInBody, db: Session = Depends(get_db)):
    """上班打卡（指定时间段）。"""
    if body.period not in PERIODS:
        raise HTTPException(400, f"period 必须是 {PERIODS}")
    # 同一时间段只能有一个进行中
    active = (
        db.query(ClockRecord)
        .filter(ClockRecord.clock_out.is_(None), ClockRecord.period == body.period)
        .first()
    )
    if active:
        raise HTTPException(400, f"{body.period} 时段已在打卡中")
    record = ClockRecord(
        clock_in=_parse_clock_time(body.clock_time),
        note=body.note,
        period=body.period,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.post("/out", response_model=ClockOut)
def clock_out(body: ClockInBody, db: Session = Depends(get_db)):
    """下班打卡（指定时间段）。"""
    if body.period not in PERIODS:
        raise HTTPException(400, f"period 必须是 {PERIODS}")
    active = (
        db.query(ClockRecord)
        .filter(ClockRecord.clock_out.is_(None), ClockRecord.period == body.period)
        .first()
    )
    if not active:
        raise HTTPException(400, f"{body.period} 时段没有进行中的打卡")
    active.clock_out = _parse_clock_time(body.clock_time)
    db.commit()
    db.refresh(active)
    return active


@router.get("/current", response_model=list[ClockOut])
def current_clock(db: Session = Depends(get_db)):
    """获取所有进行中的打卡（最多3个，每段一个）。"""
    return db.query(ClockRecord).filter(ClockRecord.clock_out.is_(None)).all()


@router.get("/records", response_model=list[ClockOut])
def list_records(days: int = 30, db: Session = Depends(get_db)):
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    return (
        db.query(ClockRecord)
        .filter(ClockRecord.clock_in >= since)
        .order_by(ClockRecord.clock_in.desc())
        .all()
    )


@router.delete("/records/{record_id}", status_code=204)
def delete_record(record_id: int, db: Session = Depends(get_db)):
    """删除单条打卡记录。"""
    record = db.query(ClockRecord).filter(ClockRecord.id == record_id).first()
    if not record:
        raise HTTPException(404, "记录不存在")
    db.delete(record)
    db.commit()


@router.delete("/records", status_code=204)
def clear_all_records(db: Session = Depends(get_db)):
    """清除全部打卡记录。"""
    db.query(ClockRecord).delete()
    db.commit()
