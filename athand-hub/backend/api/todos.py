from __future__ import annotations

import calendar
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import get_current_user
from database import get_db
from models import Todo, TodoList

router = APIRouter(prefix="/api/todos", tags=["todos"], dependencies=[Depends(get_current_user)])


# ---- 重复规则：计算下次截止日 ----
def _next_due_date(recurrence: str, base: dt.date) -> dt.date | None:
    if recurrence == "daily":
        return base + dt.timedelta(days=1)
    if recurrence.startswith("weekly:"):
        target_wd = int(recurrence.split(":")[1]) - 1  # 0=Mon … 6=Sun
        days_ahead = (target_wd - base.weekday()) % 7 or 7
        return base + dt.timedelta(days=days_ahead)
    if recurrence.startswith("monthly:"):
        day = int(recurrence.split(":")[1])
        year, month = base.year, base.month + 1
        if month > 12:
            month, year = 1, year + 1
        max_day = calendar.monthrange(year, month)[1]
        return dt.date(year, month, min(day, max_day))
    return None


# ---- Pydantic schemas ----

class TodoCreate(BaseModel):
    title: str
    description: str = ""
    priority: int = 2
    tags: str = ""
    due_date: dt.datetime | None = None
    is_important: bool = False
    my_day: bool = False
    list_id: int | None = None
    recurrence: str | None = None


class TodoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: int | None = None
    tags: str | None = None
    due_date: dt.datetime | None = None
    is_done: bool | None = None
    is_important: bool | None = None
    sort_order: int | None = None
    list_id: int | None = None
    recurrence: str | None = None


class TodoOut(BaseModel):
    id: int
    title: str
    description: str
    priority: int
    tags: str
    due_date: dt.datetime | None
    is_done: bool
    done_at: dt.datetime | None
    is_important: bool
    my_day_date: dt.date | None
    sort_order: int
    list_id: int | None
    recurrence: str | None
    created_at: dt.datetime
    updated_at: dt.datetime

    model_config = {"from_attributes": True}


class TodoListCreate(BaseModel):
    name: str
    emoji: str = "📋"


class TodoListUpdate(BaseModel):
    name: str | None = None
    emoji: str | None = None
    sort_order: int | None = None


class TodoListOut(BaseModel):
    id: int
    name: str
    emoji: str
    sort_order: int
    created_at: dt.datetime

    model_config = {"from_attributes": True}


# ---- Todo endpoints ----

@router.get("", response_model=list[TodoOut])
def list_todos(
    view: str | None = None,
    is_done: bool | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Todo)
    today = dt.date.today()

    if view == "myday":
        q = q.filter(Todo.my_day_date == today)
    elif view == "important":
        q = q.filter(Todo.is_important == True)
    elif view == "planned":
        q = q.filter(Todo.due_date.isnot(None))
    elif view and view.startswith("list:"):
        list_id = int(view.split(":", 1)[1])
        q = q.filter(Todo.list_id == list_id)
    # else: view == "all" or None → no extra filter

    if is_done is not None:
        q = q.filter(Todo.is_done == is_done)

    return q.order_by(Todo.sort_order, Todo.priority, Todo.due_date.asc().nullslast(), Todo.created_at.desc()).all()


@router.post("", response_model=TodoOut)
def create_todo(body: TodoCreate, db: Session = Depends(get_db)):
    data = body.model_dump(exclude={"my_day"})
    if body.my_day:
        data["my_day_date"] = dt.date.today()
    todo = Todo(**data)
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@router.put("/{todo_id}", response_model=TodoOut)
def update_todo(todo_id: int, body: TodoUpdate, db: Session = Depends(get_db)):
    todo = db.query(Todo).filter(Todo.id == todo_id).first()
    if not todo:
        raise HTTPException(404, "待办不存在")
    data = body.model_dump(exclude_unset=True)
    if "is_done" in data and data["is_done"] and not todo.is_done:
        data["done_at"] = dt.datetime.now(dt.timezone.utc)
        # 有重复规则时，自动创建下一个周期的任务
        recurrence = data.get("recurrence", todo.recurrence)
        if recurrence:
            base: dt.date
            if todo.due_date:
                base = todo.due_date.date() if isinstance(todo.due_date, dt.datetime) else todo.due_date
            else:
                base = dt.date.today()
            next_d = _next_due_date(recurrence, base)
            if next_d:
                new_todo = Todo(
                    title=todo.title,
                    description=todo.description,
                    priority=todo.priority,
                    tags=todo.tags,
                    due_date=dt.datetime(next_d.year, next_d.month, next_d.day),
                    is_important=todo.is_important,
                    recurrence=recurrence,
                    list_id=todo.list_id,
                )
                db.add(new_todo)
    elif "is_done" in data and not data["is_done"]:
        data["done_at"] = None
    for k, v in data.items():
        setattr(todo, k, v)
    db.commit()
    db.refresh(todo)
    return todo


@router.put("/{todo_id}/toggle-important", response_model=TodoOut)
def toggle_important(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(Todo).filter(Todo.id == todo_id).first()
    if not todo:
        raise HTTPException(404, "待办不存在")
    todo.is_important = not todo.is_important
    db.commit()
    db.refresh(todo)
    return todo


@router.put("/{todo_id}/toggle-myday", response_model=TodoOut)
def toggle_myday(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(Todo).filter(Todo.id == todo_id).first()
    if not todo:
        raise HTTPException(404, "待办不存在")
    today = dt.date.today()
    todo.my_day_date = None if todo.my_day_date == today else today
    db.commit()
    db.refresh(todo)
    return todo


@router.delete("/{todo_id}")
def delete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(Todo).filter(Todo.id == todo_id).first()
    if not todo:
        raise HTTPException(404, "待办不存在")
    db.delete(todo)
    db.commit()
    return {"ok": True}


# ---- TodoList endpoints ----

@router.get("/lists", response_model=list[TodoListOut])
def list_todo_lists(db: Session = Depends(get_db)):
    return db.query(TodoList).order_by(TodoList.sort_order, TodoList.id).all()


@router.post("/lists", response_model=TodoListOut)
def create_todo_list(body: TodoListCreate, db: Session = Depends(get_db)):
    tl = TodoList(**body.model_dump())
    db.add(tl)
    db.commit()
    db.refresh(tl)
    return tl


@router.put("/lists/{list_id}", response_model=TodoListOut)
def update_todo_list(list_id: int, body: TodoListUpdate, db: Session = Depends(get_db)):
    tl = db.query(TodoList).filter(TodoList.id == list_id).first()
    if not tl:
        raise HTTPException(404, "列表不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(tl, k, v)
    db.commit()
    db.refresh(tl)
    return tl


@router.delete("/lists/{list_id}")
def delete_todo_list(list_id: int, db: Session = Depends(get_db)):
    tl = db.query(TodoList).filter(TodoList.id == list_id).first()
    if not tl:
        raise HTTPException(404, "列表不存在")
    # Unlink todos in this list
    db.query(Todo).filter(Todo.list_id == list_id).update({Todo.list_id: None})
    db.delete(tl)
    db.commit()
    return {"ok": True}
