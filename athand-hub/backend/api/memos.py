from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import Memo

router = APIRouter(prefix="/api/memos", tags=["memos"], dependencies=[Depends(get_current_user)])


class MemoCreate(BaseModel):
    title: str = ""
    content: str = ""
    tags: str = ""
    is_pinned: bool = False


class MemoUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: str | None = None
    is_pinned: bool | None = None
    is_archived: bool | None = None


class MemoOut(BaseModel):
    id: int
    title: str
    content: str
    tags: str
    is_pinned: bool
    is_archived: bool
    created_at: dt.datetime
    updated_at: dt.datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[MemoOut])
def list_memos(archived: bool = False, search: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Memo).filter(Memo.is_archived == archived)
    if search:
        like = f"%{search}%"
        q = q.filter((Memo.title.ilike(like)) | (Memo.content.ilike(like)))
    return q.order_by(Memo.is_pinned.desc(), Memo.updated_at.desc()).all()


@router.post("", response_model=MemoOut)
def create_memo(body: MemoCreate, db: Session = Depends(get_db)):
    memo = Memo(**body.model_dump())
    db.add(memo)
    db.commit()
    db.refresh(memo)
    return memo


@router.put("/{memo_id}", response_model=MemoOut)
def update_memo(memo_id: int, body: MemoUpdate, db: Session = Depends(get_db)):
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(404, "备忘录不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(memo, k, v)
    db.commit()
    db.refresh(memo)
    return memo


@router.delete("/{memo_id}")
def delete_memo(memo_id: int, db: Session = Depends(get_db)):
    memo = db.query(Memo).filter(Memo.id == memo_id).first()
    if not memo:
        raise HTTPException(404, "备忘录不存在")
    db.delete(memo)
    db.commit()
    return {"ok": True}
