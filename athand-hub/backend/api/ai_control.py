from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.ai_control_schemas import (
    AiControlBackfillHistoryPreviewsBody,
    AiControlBackfillHistoryPreviewsResponse,
    AiControlCreateSessionBody,
    AiControlHistoryResponse,
    AiControlMachineOut,
    AiControlPermissionBody,
    AiControlPermissionResponse,
    AiControlProvidersResponse,
    AiControlResumeSessionBody,
    AiControlSendMessageBody,
    AiControlSendMessageResponse,
    AiControlSessionOut,
    AiControlTimelineResponse,
)
from api.auth import get_current_user
from database import get_db
from services.ai_control_bridge import bridge_service

router = APIRouter(prefix="/api/ai-control", tags=["ai-control"], dependencies=[Depends(get_current_user)])


@router.get("/machines", response_model=list[AiControlMachineOut])
def list_ai_control_machines(db: Session = Depends(get_db)):
    return bridge_service.list_machines(db)


@router.get("/providers", response_model=AiControlProvidersResponse)
def list_ai_control_providers(
    machine_id: str = Query(...),
    cwd: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return bridge_service.list_providers(machine_id=machine_id, db=db, cwd=cwd)


@router.post("/sessions", response_model=AiControlSessionOut)
def create_ai_control_session(body: AiControlCreateSessionBody, db: Session = Depends(get_db)):
    return bridge_service.create_session(body=body, db=db)


@router.get("/sessions/{agent_id}", response_model=AiControlSessionOut)
def get_ai_control_session(
    agent_id: str,
    machine_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return bridge_service.get_session(agent_id=agent_id, machine_id=machine_id, db=db)


@router.post("/sessions/{agent_id}/messages", response_model=AiControlSendMessageResponse)
def send_ai_control_message(
    agent_id: str,
    body: AiControlSendMessageBody,
    machine_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return bridge_service.send_message(agent_id=agent_id, body=body, machine_id=machine_id, db=db)


@router.post("/sessions/{agent_id}/resume", response_model=AiControlSessionOut)
def resume_ai_control_session(
    agent_id: str,
    body: AiControlResumeSessionBody,
    db: Session = Depends(get_db),
):
    return bridge_service.resume_session(body=body, db=db)


@router.get("/sessions/{agent_id}/timeline", response_model=AiControlTimelineResponse)
def get_ai_control_timeline(
    agent_id: str,
    machine_id: str | None = Query(None),
    cursor: str | None = Query(None),
    direction: str = Query("backward"),
    limit: int = Query(50, ge=1, le=200),
    projection: str = Query("full"),
    db: Session = Depends(get_db),
):
    return bridge_service.get_timeline(
        agent_id=agent_id,
        machine_id=machine_id,
        cursor=cursor,
        direction=direction,
        limit=limit,
        projection=projection,
        db=db,
    )


@router.get("/history", response_model=AiControlHistoryResponse)
def get_ai_control_history(
    machine_id: str | None = Query(None),
    provider: str | None = Query(None),
    status: str | None = Query(None),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return bridge_service.get_history(
        machine_id=machine_id,
        provider=provider,
        status=status,
        cursor=cursor,
        limit=limit,
        db=db,
    )


@router.post("/history/backfill-previews", response_model=AiControlBackfillHistoryPreviewsResponse)
def backfill_ai_control_history_previews(
    body: AiControlBackfillHistoryPreviewsBody,
    db: Session = Depends(get_db),
):
    return bridge_service.backfill_history_previews(body=body, db=db)


@router.post("/permissions/{agent_id}/{request_id}", response_model=AiControlPermissionResponse)
def respond_ai_control_permission(
    agent_id: str,
    request_id: str,
    body: AiControlPermissionBody,
    machine_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    return bridge_service.respond_permission(
        agent_id=agent_id,
        request_id=request_id,
        body=body,
        machine_id=machine_id,
        db=db,
    )