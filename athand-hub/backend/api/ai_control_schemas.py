from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AiControlMachineOut(BaseModel):
    id: str
    name: str
    machine_type: str
    os_info: str | None = None
    is_online: bool
    daemon_reachable: bool
    daemon_url: str | None = None
    runtime_kind: str = "paseo"
    last_heartbeat: dt.datetime | None = None
    last_daemon_seen_at: dt.datetime | None = None


class AiControlProviderModeOut(BaseModel):
    id: str
    label: str
    description: str | None = None
    icon: str | None = None
    color_tier: str | None = None


class AiControlProviderModelOut(BaseModel):
    id: str
    label: str
    description: str | None = None
    is_default: bool = False


class AiControlSelectOptionOut(BaseModel):
    id: str
    label: str
    description: str | None = None
    is_default: bool = False


class AiControlFeatureToggleOut(BaseModel):
    type: Literal["toggle"]
    id: str
    label: str
    description: str | None = None
    value: bool


class AiControlFeatureSelectOut(BaseModel):
    type: Literal["select"]
    id: str
    label: str
    description: str | None = None
    value: str | None = None
    options: list[AiControlSelectOptionOut] = Field(default_factory=list)


AiControlFeatureOut = AiControlFeatureToggleOut | AiControlFeatureSelectOut


class AiControlProviderOut(BaseModel):
    id: str
    label: str
    description: str | None = None
    status: Literal["ready", "loading", "error", "unavailable"]
    default_mode_id: str | None = None
    modes: list[AiControlProviderModeOut] = Field(default_factory=list)
    models: list[AiControlProviderModelOut] = Field(default_factory=list)
    features: list[AiControlFeatureOut] = Field(default_factory=list)
    error: str | None = None
    fetched_at: str | None = None


class AiControlProvidersResponse(BaseModel):
    machine: AiControlMachineOut
    providers: list[AiControlProviderOut]
    snapshot_version: str | None = None
    fetched_at: dt.datetime


class AiControlPersistenceHandle(BaseModel):
    provider: str
    session_id: str
    native_handle: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AiControlCapabilitiesOut(BaseModel):
    supports_streaming: bool
    supports_session_persistence: bool
    supports_dynamic_modes: bool
    supports_mcp_servers: bool
    supports_reasoning_stream: bool
    supports_tool_invocations: bool


class AiControlSessionOut(BaseModel):
    agent_id: str
    machine_id: str
    provider: str
    cwd: str
    title: str | None = None
    status: str
    mode_id: str | None = None
    model: str | None = None
    created_at: dt.datetime
    updated_at: dt.datetime
    attention: bool = False
    attention_reason: str | None = None
    persistence_handle: AiControlPersistenceHandle | None = None
    capabilities: AiControlCapabilitiesOut | None = None


class AiControlCreateSessionBody(BaseModel):
    machine_id: str
    provider: str
    cwd: str
    initial_prompt: str
    mode_id: str | None = None
    model: str | None = None
    thinking_option_id: str | None = None
    title: str | None = None
    labels: dict[str, str] = Field(default_factory=dict)
    feature_values: dict[str, Any] = Field(default_factory=dict)
    approval_policy: str | None = None
    sandbox_mode: str | None = None
    network_access: bool | None = None
    web_search: bool | None = None
    mcp_servers: dict[str, dict[str, Any]] = Field(default_factory=dict)


class AiControlSendMessageBody(BaseModel):
    text: str
    client_message_id: str | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    images: list[dict[str, str]] = Field(default_factory=list)


class AiControlSendMessageResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    accepted: bool
    request_id: str = Field(alias="requestId")
    agent_id: str = Field(alias="agentId")


class AiControlResumeSessionBody(BaseModel):
    machine_id: str
    handle: AiControlPersistenceHandle
    overrides: dict[str, Any] = Field(default_factory=dict)


class AiControlTimelineItemOut(BaseModel):
    id: str
    kind: str
    created_at: dt.datetime
    seq: int | None = None
    role: str | None = None
    text: str | None = None
    status: str | None = None
    provider: str | None = None
    tool_name: str | None = None
    tool_call_id: str | None = None
    arguments: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    usage: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AiControlTimelinePageOut(BaseModel):
    items: list[AiControlTimelineItemOut] = Field(default_factory=list)
    next_cursor: str | None = None
    prev_cursor: str | None = None
    has_more_before: bool = False
    has_more_after: bool = False


class AiControlTimelineResponse(BaseModel):
    session: AiControlSessionOut
    page: AiControlTimelinePageOut


class AiControlHistoryItemOut(BaseModel):
    agent_id: str
    machine_id: str
    provider: str
    title: str | None = None
    cwd: str
    status: str
    created_at: dt.datetime
    updated_at: dt.datetime
    last_message_preview: str | None = None
    attention: bool = False
    attention_reason: str | None = None
    persistence_handle: AiControlPersistenceHandle | None = None


class AiControlHistoryResponse(BaseModel):
    items: list[AiControlHistoryItemOut] = Field(default_factory=list)
    next_cursor: str | None = None


class AiControlPermissionBody(BaseModel):
    behavior: Literal["allow", "deny"]
    selected_action_id: str | None = None
    message: str | None = None
    interrupt: bool | None = None
    updated_input: dict[str, Any] = Field(default_factory=dict)
    updated_permissions: list[dict[str, Any]] = Field(default_factory=list)


class AiControlPermissionResolvedOut(BaseModel):
    request_id: str
    agent_id: str
    behavior: Literal["allow", "deny"]
    selected_action_id: str | None = None


class AiControlPermissionResponse(BaseModel):
    ok: bool = True
    resolved: AiControlPermissionResolvedOut | None = None