from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import Machine

router = APIRouter(prefix="/api/agents", tags=["agents"], dependencies=[Depends(get_current_user)])


class MachineOut(BaseModel):
    id: str
    name: str
    machine_type: str
    os_info: str | None
    is_online: bool
    last_heartbeat: dt.datetime | None

    model_config = {"from_attributes": True}


@router.get("/machines", response_model=list[MachineOut])
def list_machines(db: Session = Depends(get_db)):
    return db.query(Machine).order_by(Machine.name).all()


@router.get("/machines/{machine_id}", response_model=MachineOut)
def get_machine(machine_id: str, db: Session = Depends(get_db)):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        from fastapi import HTTPException

        raise HTTPException(404, "机器不存在")
    return m
