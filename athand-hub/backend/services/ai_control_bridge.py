from __future__ import annotations

import asyncio
import datetime as dt
import json
import re
from typing import Any
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

try:
    import websockets
    from websockets.asyncio.client import connect as ws_connect

    WEBSOCKET_EXCEPTIONS = (OSError, websockets.exceptions.WebSocketException)
except ImportError:
    websockets = None
    ws_connect = None
    WEBSOCKET_EXCEPTIONS = (OSError,)

from api.ai_control_schemas import (
    AiControlBackfillHistoryPreviewsBody,
    AiControlBackfillHistoryPreviewResult,
    AiControlBackfillHistoryPreviewsResponse,
    AiControlCapabilitiesOut,
    AiControlCreateSessionBody,
    AiControlHistoryItemOut,
    AiControlHistoryResponse,
    AiControlMachineOut,
    AiControlPersistenceHandle,
    AiControlProviderModeOut,
    AiControlProviderModelOut,
    AiControlProviderOut,
    AiControlPermissionBody,
    AiControlPermissionResolvedOut,
    AiControlPermissionResponse,
    AiControlProvidersResponse,
    AiControlResumeSessionBody,
    AiControlSendMessageBody,
    AiControlSendMessageResponse,
    AiControlSessionOut,
    AiControlTimelineItemOut,
    AiControlTimelinePageOut,
    AiControlTimelineResponse,
)
from config import settings
from models import Machine


class AiControlBridgeTransportError(RuntimeError):
    pass


class AiControlBridgeTimeoutError(TimeoutError):
    pass


class AiControlBridgeProtocolError(RuntimeError):
    pass


class AiControlBridgeService:
    """Phase 1 bridge service.

    The first real integration step is intentionally narrow: reach the paseo
    daemon, complete the hello handshake, and map provider snapshots into the
    AtHand bridge model without touching the legacy Kimi task pipeline.
    """

    _RPC_TIMEOUT_SECONDS = 8.0
    _WS_OPEN_TIMEOUT_SECONDS = 5.0
    _PASEO_CLIENT_APP_VERSION = "0.1.50"
    _HISTORY_PREVIEW_TEXT_LIMIT = 220
    _HISTORY_PREVIEW_LINE_JOIN_THRESHOLD = 24

    def __init__(self) -> None:
        self._machine_daemon_map = self._parse_machine_daemon_map(settings.ai_control_machine_daemons)

    @staticmethod
    def _parse_machine_daemon_map(raw: str) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for part in raw.split(","):
            item = part.strip()
            if not item or "=" not in item:
                continue
            machine_id, daemon_url = item.split("=", 1)
            machine_id = machine_id.strip()
            daemon_url = daemon_url.strip()
            if machine_id and daemon_url:
                mapping[machine_id] = daemon_url
        return mapping

    def _daemon_url_for_machine(self, machine_id: str) -> str | None:
        return self._machine_daemon_map.get(machine_id) or settings.ai_control_default_daemon_url or None

    @staticmethod
    def _normalize_daemon_ws_url(daemon_url: str) -> str:
        raw = daemon_url.strip()
        if not raw:
            raise ValueError("paseo daemon 地址为空")

        if "://" not in raw:
            raw = f"ws://{raw}"

        parsed = urlparse(raw)
        scheme = parsed.scheme.lower()
        path = parsed.path or ""
        if not path or path == "/":
            path = "/ws"

        if scheme == "http":
            scheme = "ws"
        elif scheme == "https":
            scheme = "wss"
        elif scheme not in {"ws", "wss"}:
            raise ValueError(f"不支持的 paseo daemon 协议: {parsed.scheme}")

        return urlunparse(parsed._replace(scheme=scheme, path=path))

    def _next_request_id(self, prefix: str) -> str:
        return f"athand-{prefix}-{uuid4().hex}"

    def _run_async(self, coroutine: Any):
        return asyncio.run(coroutine)

    @staticmethod
    def _is_agent_not_found_error(detail: str | None) -> bool:
        if not detail:
            return False
        return "agent not found" in detail.lower()

    async def _recv_ws_json(self, websocket: Any) -> dict[str, Any]:
        try:
            raw = await asyncio.wait_for(websocket.recv(), timeout=self._RPC_TIMEOUT_SECONDS)
        except asyncio.TimeoutError as exc:
            raise AiControlBridgeTimeoutError("等待 paseo daemon 响应超时") from exc

        if not isinstance(raw, str):
            raise AiControlBridgeProtocolError("paseo daemon 返回了非文本消息")

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AiControlBridgeProtocolError("paseo daemon 返回了无效 JSON") from exc

        if not isinstance(parsed, dict):
            raise AiControlBridgeProtocolError("paseo daemon 返回了无效消息结构")

        return parsed

    async def _wait_for_server_info(self, websocket: Any) -> dict[str, Any]:
        while True:
            message = await self._recv_ws_json(websocket)
            if message.get("type") != "session":
                continue

            session_message = message.get("message")
            if not isinstance(session_message, dict):
                continue

            if session_message.get("type") != "status":
                continue

            payload = session_message.get("payload")
            if isinstance(payload, dict) and payload.get("status") == "server_info":
                return payload

    async def _wait_for_response(
        self,
        websocket: Any,
        *,
        request_id: str,
        response_type: str,
    ) -> dict[str, Any]:
        while True:
            message = await self._recv_ws_json(websocket)
            if message.get("type") != "session":
                continue

            session_message = message.get("message")
            if not isinstance(session_message, dict):
                continue

            message_type = session_message.get("type")
            payload = session_message.get("payload")

            if message_type == "rpc_error" and isinstance(payload, dict) and payload.get("requestId") == request_id:
                raise AiControlBridgeProtocolError(payload.get("error") or "paseo daemon RPC 返回错误")

            if message_type != response_type or not isinstance(payload, dict):
                continue

            if payload.get("requestId") != request_id:
                continue

            return payload

    async def _connect_and_exchange(
        self,
        daemon_url: str,
        requests: list[tuple[dict[str, Any], str]],
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        if ws_connect is None or websockets is None:
            raise AiControlBridgeTransportError("后端未安装 websockets 依赖，无法连接 paseo daemon")

        ws_url = self._normalize_daemon_ws_url(daemon_url)

        try:
            async with ws_connect(
                ws_url,
                ping_interval=None,
                open_timeout=self._WS_OPEN_TIMEOUT_SECONDS,
                close_timeout=1,
            ) as websocket:
                await websocket.send(
                    json.dumps(
                        {
                            "type": "hello",
                            "clientId": settings.ai_control_default_client_id,
                            "clientType": "cli",
                            "protocolVersion": 1,
                            "appVersion": self._PASEO_CLIENT_APP_VERSION,
                        }
                    )
                )

                server_info = await self._wait_for_server_info(websocket)
                responses: list[dict[str, Any]] = []

                for request, response_type in requests:
                    await websocket.send(json.dumps({"type": "session", "message": request}))
                    responses.append(
                        await self._wait_for_response(
                            websocket,
                            request_id=request["requestId"],
                            response_type=response_type,
                        )
                    )

                return server_info, responses
        except AiControlBridgeTimeoutError:
            raise
        except AiControlBridgeProtocolError:
            raise
        except asyncio.TimeoutError as exc:
            raise AiControlBridgeTimeoutError("连接 paseo daemon 超时") from exc
        except WEBSOCKET_EXCEPTIONS as exc:
            raise AiControlBridgeTransportError(f"连接 paseo daemon 失败: {exc}") from exc

    async def _create_agent(self, daemon_url: str, body: AiControlCreateSessionBody) -> dict[str, Any]:
        if ws_connect is None or websockets is None:
            raise AiControlBridgeTransportError("后端未安装 websockets 依赖，无法连接 paseo daemon")

        ws_url = self._normalize_daemon_ws_url(daemon_url)
        request_id = self._next_request_id("create-session")
        config: dict[str, Any] = {
            "provider": body.provider,
            "cwd": body.cwd,
            **({"modeId": body.mode_id} if body.mode_id else {}),
            **({"model": body.model} if body.model else {}),
            **({"thinkingOptionId": body.thinking_option_id} if body.thinking_option_id else {}),
            **({"title": body.title} if body.title is not None else {}),
            **({"featureValues": body.feature_values} if body.feature_values else {}),
            **({"approvalPolicy": body.approval_policy} if body.approval_policy else {}),
            **({"sandboxMode": body.sandbox_mode} if body.sandbox_mode else {}),
            **({"networkAccess": body.network_access} if body.network_access is not None else {}),
            **({"webSearch": body.web_search} if body.web_search is not None else {}),
            **({"mcpServers": body.mcp_servers} if body.mcp_servers else {}),
        }
        message = {
            "type": "create_agent_request",
            "requestId": request_id,
            "config": config,
            "initialPrompt": body.initial_prompt,
            **({"labels": body.labels} if body.labels else {}),
        }

        try:
            async with ws_connect(
                ws_url,
                ping_interval=None,
                open_timeout=self._WS_OPEN_TIMEOUT_SECONDS,
                close_timeout=1,
            ) as websocket:
                await websocket.send(
                    json.dumps(
                        {
                            "type": "hello",
                            "clientId": settings.ai_control_default_client_id,
                            "clientType": "cli",
                            "protocolVersion": 1,
                            "appVersion": self._PASEO_CLIENT_APP_VERSION,
                        }
                    )
                )
                await self._wait_for_server_info(websocket)
                await websocket.send(json.dumps({"type": "session", "message": message}))

                while True:
                    payload = await self._recv_ws_json(websocket)
                    if payload.get("type") != "session":
                        continue

                    session_message = payload.get("message")
                    if not isinstance(session_message, dict):
                        continue

                    message_type = session_message.get("type")
                    session_payload = session_message.get("payload")
                    if not isinstance(session_payload, dict):
                        continue

                    if message_type == "rpc_error" and session_payload.get("requestId") == request_id:
                        raise AiControlBridgeProtocolError(
                            session_payload.get("error") or "paseo daemon createAgent RPC 返回错误"
                        )

                    if message_type != "status" or session_payload.get("requestId") != request_id:
                        continue

                    status = session_payload.get("status")
                    if status == "agent_create_failed":
                        raise AiControlBridgeProtocolError(
                            session_payload.get("error") or "paseo daemon 创建会话失败"
                        )
                    if status == "agent_created" and isinstance(session_payload.get("agent"), dict):
                        return session_payload["agent"]
        except AiControlBridgeTimeoutError:
            raise
        except AiControlBridgeProtocolError:
            raise
        except asyncio.TimeoutError as exc:
            raise AiControlBridgeTimeoutError("连接 paseo daemon 超时") from exc
        except WEBSOCKET_EXCEPTIONS as exc:
            raise AiControlBridgeTransportError(f"连接 paseo daemon 失败: {exc}") from exc

    async def _fetch_agent_timeline(
        self,
        daemon_url: str,
        *,
        agent_id: str,
        direction: str = "tail",
        cursor: dict[str, Any] | None = None,
        limit: int | None = 0,
        projection: str = "projected",
    ) -> dict[str, Any]:
        request_id = self._next_request_id("timeline")
        request: dict[str, Any] = {
            "type": "fetch_agent_timeline_request",
            "requestId": request_id,
            "agentId": agent_id,
            **({"direction": direction} if direction else {}),
            **({"cursor": cursor} if cursor else {}),
            **({"limit": limit} if isinstance(limit, int) else {}),
            **({"projection": projection} if projection else {}),
        }
        _, responses = await self._connect_and_exchange(
            daemon_url,
            [(request, "fetch_agent_timeline_response")],
        )
        return responses[0]

    @staticmethod
    def _normalize_session_overrides(overrides: dict[str, Any]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        field_map = {
            "cwd": "cwd",
            "mode_id": "modeId",
            "model": "model",
            "title": "title",
            "approval_policy": "approvalPolicy",
            "sandbox_mode": "sandboxMode",
            "network_access": "networkAccess",
            "web_search": "webSearch",
            "feature_values": "featureValues",
            "thinking_option_id": "thinkingOptionId",
            "mcp_servers": "mcpServers",
        }
        for key, value in overrides.items():
            normalized[field_map.get(key, key)] = value
        return normalized

    async def _resume_agent(self, daemon_url: str, body: AiControlResumeSessionBody) -> dict[str, Any]:
        handle = {
            "provider": body.handle.provider,
            "sessionId": body.handle.session_id,
            **({"nativeHandle": body.handle.native_handle} if body.handle.native_handle else {}),
            **({"metadata": body.handle.metadata} if body.handle.metadata else {}),
        }
        request_id = self._next_request_id("resume-session")
        request = {
            "type": "resume_agent_request",
            "requestId": request_id,
            "handle": handle,
            **(
                {"overrides": self._normalize_session_overrides(body.overrides)}
                if body.overrides
                else {}
            ),
        }
        _, responses = await self._connect_and_exchange(
            daemon_url,
            [(request, "status")],
        )
        payload = responses[0]
        if payload.get("status") != "agent_resumed":
            raise AiControlBridgeProtocolError("paseo daemon 恢复会话返回了意外状态")
        snapshot = payload.get("agent")
        if not isinstance(snapshot, dict):
            raise AiControlBridgeProtocolError("paseo daemon 未返回有效的会话快照")
        return snapshot

    async def _send_agent_message(
        self,
        daemon_url: str,
        *,
        agent_id: str,
        body: AiControlSendMessageBody,
    ) -> dict[str, Any]:
        request_id = self._next_request_id("send-message")
        request = {
            "type": "send_agent_message_request",
            "requestId": request_id,
            "agentId": agent_id,
            "text": body.text,
            **({"messageId": body.client_message_id} if body.client_message_id else {}),
            **({"attachments": body.attachments} if body.attachments else {}),
            **({"images": body.images} if body.images else {}),
        }
        _, responses = await self._connect_and_exchange(
            daemon_url,
            [(request, "send_agent_message_response")],
        )
        payload = responses[0]
        if payload.get("requestId") != request_id:
            raise AiControlBridgeProtocolError("paseo daemon 返回了无效的消息发送响应")
        return payload

    async def _fetch_agent_history(
        self,
        daemon_url: str,
        *,
        status: str | None,
        cursor: str | None,
        limit: int,
    ) -> dict[str, Any]:
        request_id = self._next_request_id("history")
        request: dict[str, Any] = {
            "type": "fetch_agent_history_request",
            "requestId": request_id,
            "sort": [{"key": "updated_at", "direction": "desc"}],
            "page": {
                "limit": limit,
                **({"cursor": cursor} if cursor else {}),
            },
        }
        if status:
            request["filter"] = {"statuses": [status]}

        _, responses = await self._connect_and_exchange(
            daemon_url,
            [(request, "fetch_agent_history_response")],
        )
        return responses[0]

    async def _backfill_agent_preview(self, daemon_url: str, *, agent_id: str) -> dict[str, Any]:
        request_id = self._next_request_id("backfill-preview")
        request = {
            "type": "backfill_agent_preview_request",
            "requestId": request_id,
            "agentId": agent_id,
        }
        _, responses = await self._connect_and_exchange(
            daemon_url,
            [(request, "backfill_agent_preview_response")],
        )
        return responses[0]

    @staticmethod
    def _normalize_permission_response(body: AiControlPermissionBody) -> dict[str, Any]:
        response: dict[str, Any] = {"behavior": body.behavior}
        if body.selected_action_id:
            response["selectedActionId"] = body.selected_action_id
        if body.behavior == "allow":
            if body.updated_input:
                response["updatedInput"] = body.updated_input
            if body.updated_permissions:
                response["updatedPermissions"] = body.updated_permissions
        else:
            if body.message:
                response["message"] = body.message
            if body.interrupt is not None:
                response["interrupt"] = body.interrupt
        return response

    async def _respond_to_permission(
        self,
        daemon_url: str,
        *,
        agent_id: str,
        request_id: str,
        body: AiControlPermissionBody,
    ) -> dict[str, Any]:
        request = {
            "type": "agent_permission_response",
            "agentId": agent_id,
            "requestId": request_id,
            "response": self._normalize_permission_response(body),
        }
        _, responses = await self._connect_and_exchange(
            daemon_url,
            [(request, "agent_permission_resolved")],
        )
        return responses[0]

    def _probe_daemon(self, daemon_url: str) -> tuple[bool, dt.datetime | None]:
        try:
            self._run_async(self._connect_and_exchange(daemon_url, []))
        except (AiControlBridgeTransportError, AiControlBridgeTimeoutError, AiControlBridgeProtocolError, ValueError):
            return False, None

        return True, dt.datetime.now(dt.timezone.utc)

    @staticmethod
    def _provider_label(provider_id: str) -> str:
        return provider_id.replace("-", " ").replace("_", " ").title()

    @staticmethod
    def _provider_status_from_payloads(
        snapshot_entry: dict[str, Any] | None,
        availability_entry: dict[str, Any] | None,
    ) -> str:
        snapshot_status = snapshot_entry.get("status") if snapshot_entry else None
        availability_error = availability_entry.get("error") if availability_entry else None
        available = availability_entry.get("available") if availability_entry else None

        if availability_error:
            return "error"
        if available is False:
            return "unavailable"
        if snapshot_status in {"ready", "loading", "error", "unavailable"}:
            return str(snapshot_status)
        return "ready"

    def _provider_out(
        self,
        provider_id: str,
        snapshot_entry: dict[str, Any] | None,
        availability_entry: dict[str, Any] | None,
        *,
        default_fetched_at: str | None,
    ) -> AiControlProviderOut:
        entry = snapshot_entry or {}
        models = entry.get("models") if isinstance(entry.get("models"), list) else []
        modes = entry.get("modes") if isinstance(entry.get("modes"), list) else []
        error = entry.get("error") or (availability_entry or {}).get("error")

        return AiControlProviderOut(
            id=provider_id,
            label=entry.get("label") or self._provider_label(provider_id),
            description=entry.get("description"),
            status=self._provider_status_from_payloads(snapshot_entry, availability_entry),
            default_mode_id=entry.get("defaultModeId"),
            modes=[
                AiControlProviderModeOut(
                    id=str(mode.get("id") or ""),
                    label=str(mode.get("label") or mode.get("id") or ""),
                    description=mode.get("description"),
                    icon=mode.get("icon"),
                    color_tier=mode.get("colorTier"),
                )
                for mode in modes
                if isinstance(mode, dict) and mode.get("id")
            ],
            models=[
                AiControlProviderModelOut(
                    id=str(model.get("id") or ""),
                    label=str(model.get("label") or model.get("id") or ""),
                    description=model.get("description"),
                    is_default=bool(model.get("isDefault", False)),
                )
                for model in models
                if isinstance(model, dict) and model.get("id")
            ],
            features=[],
            error=error,
            fetched_at=entry.get("fetchedAt") or default_fetched_at,
        )

    @staticmethod
    def _parse_timestamp(value: Any) -> dt.datetime:
        if not isinstance(value, str) or not value:
            return dt.datetime.now(dt.timezone.utc)

        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return dt.datetime.now(dt.timezone.utc)

        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=dt.timezone.utc)
        return parsed

    @staticmethod
    def _persistence_handle_out(payload: dict[str, Any] | None) -> AiControlPersistenceHandle | None:
        if not isinstance(payload, dict):
            return None
        session_id = payload.get("sessionId")
        provider = payload.get("provider")
        if not isinstance(session_id, str) or not isinstance(provider, str):
            return None

        metadata = payload.get("metadata")
        return AiControlPersistenceHandle(
            provider=provider,
            session_id=session_id,
            native_handle=payload.get("nativeHandle") if isinstance(payload.get("nativeHandle"), str) else None,
            metadata=metadata if isinstance(metadata, dict) else {},
        )

    @staticmethod
    def _capabilities_out(payload: dict[str, Any] | None) -> AiControlCapabilitiesOut | None:
        if not isinstance(payload, dict):
            return None

        return AiControlCapabilitiesOut(
            supports_streaming=bool(payload.get("supportsStreaming", False)),
            supports_session_persistence=bool(payload.get("supportsSessionPersistence", False)),
            supports_dynamic_modes=bool(payload.get("supportsDynamicModes", False)),
            supports_mcp_servers=bool(payload.get("supportsMcpServers", False)),
            supports_reasoning_stream=bool(payload.get("supportsReasoningStream", False)),
            supports_tool_invocations=bool(payload.get("supportsToolInvocations", False)),
        )

    def _session_out_from_snapshot(self, machine_id: str, snapshot: dict[str, Any]) -> AiControlSessionOut:
        return AiControlSessionOut(
            agent_id=str(snapshot.get("id") or ""),
            machine_id=machine_id,
            provider=str(snapshot.get("provider") or ""),
            cwd=str(snapshot.get("cwd") or ""),
            title=snapshot.get("title") if isinstance(snapshot.get("title"), str) else None,
            status=str(snapshot.get("status") or "unknown"),
            mode_id=snapshot.get("currentModeId") if isinstance(snapshot.get("currentModeId"), str) else None,
            model=snapshot.get("model") if isinstance(snapshot.get("model"), str) else None,
            created_at=self._parse_timestamp(snapshot.get("createdAt")),
            updated_at=self._parse_timestamp(snapshot.get("updatedAt")),
            attention=bool(snapshot.get("requiresAttention", False)),
            attention_reason=snapshot.get("attentionReason") if isinstance(snapshot.get("attentionReason"), str) else None,
            persistence_handle=self._persistence_handle_out(snapshot.get("persistence")),
            capabilities=self._capabilities_out(snapshot.get("capabilities")),
        )

    @staticmethod
    def _encode_cursor(cursor: dict[str, Any] | None) -> str | None:
        if not isinstance(cursor, dict):
            return None
        epoch = cursor.get("epoch")
        seq = cursor.get("seq")
        if not isinstance(epoch, str) or not isinstance(seq, int):
            return None
        return json.dumps({"epoch": epoch, "seq": seq}, separators=(",", ":"))

    @staticmethod
    def _decode_cursor(cursor: str | None) -> dict[str, Any] | None:
        if not cursor:
            return None
        try:
            payload = json.loads(cursor)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, "timeline cursor 无效") from exc

        if not isinstance(payload, dict):
            raise HTTPException(400, "timeline cursor 无效")
        epoch = payload.get("epoch")
        seq = payload.get("seq")
        if not isinstance(epoch, str) or not isinstance(seq, int):
            raise HTTPException(400, "timeline cursor 无效")
        return {"epoch": epoch, "seq": seq}

    @staticmethod
    def _daemon_timeline_direction(direction: str, has_cursor: bool) -> str:
        if direction == "backward":
            return "before" if has_cursor else "tail"
        if direction == "forward":
            return "after"
        raise HTTPException(400, "timeline direction 无效")

    @staticmethod
    def _daemon_timeline_projection(projection: str) -> str:
        if projection == "full":
            return "canonical"
        if projection in {"messages", "summary"}:
            return "projected"
        raise HTTPException(400, "timeline projection 无效")

    def _timeline_item_out(self, entry: dict[str, Any]) -> AiControlTimelineItemOut | None:
        item = entry.get("item")
        if not isinstance(item, dict):
            return None

        item_type = str(item.get("type") or "unknown")
        seq_start = entry.get("seqStart")
        seq_end = entry.get("seqEnd")
        seq_value = seq_end if isinstance(seq_end, int) else seq_start if isinstance(seq_start, int) else None
        item_id = item.get("messageId") or item.get("callId") or f"{entry.get('timestamp')}-{seq_start}-{item_type}"

        role: str | None = None
        text: str | None = None
        status: str | None = None
        tool_name: str | None = None
        tool_call_id: str | None = None
        arguments: dict[str, Any] | None = None
        result: dict[str, Any] | None = None
        metadata: dict[str, Any] = {}

        if item_type == "user_message":
            role = "user"
            text = item.get("text") if isinstance(item.get("text"), str) else None
        elif item_type in {"assistant_message", "reasoning"}:
            role = "assistant"
            text = item.get("text") if isinstance(item.get("text"), str) else None
        elif item_type == "tool_call":
            role = "tool"
            status = item.get("status") if isinstance(item.get("status"), str) else None
            tool_name = item.get("name") if isinstance(item.get("name"), str) else None
            tool_call_id = item.get("callId") if isinstance(item.get("callId"), str) else None
            detail = item.get("detail")
            if isinstance(detail, dict):
                arguments = detail
            elif detail is not None:
                arguments = {"detail": detail}
            if item.get("error") not in {None, ""}:
                result = {"error": item.get("error")}
            raw_metadata = item.get("metadata")
            metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
        elif item_type == "todo":
            todo_items = item.get("items") if isinstance(item.get("items"), list) else []
            role = "assistant"
            text = "\n".join(
                f"[{'x' if bool(todo.get('completed')) else ' '}] {todo.get('text', '')}"
                for todo in todo_items
                if isinstance(todo, dict)
            ) or None
            metadata = {"items": todo_items}
        elif item_type == "error":
            role = "system"
            text = item.get("message") if isinstance(item.get("message"), str) else None
        elif item_type == "compaction":
            role = "system"
            status = item.get("status") if isinstance(item.get("status"), str) else None
            metadata = {
                key: value
                for key, value in item.items()
                if key not in {"type", "status"}
            }
        else:
            metadata = {"raw_item": item}

        return AiControlTimelineItemOut(
            id=str(item_id),
            kind=item_type,
            created_at=self._parse_timestamp(entry.get("timestamp")),
            seq=seq_value,
            role=role,
            text=text,
            status=status,
            provider=entry.get("provider") if isinstance(entry.get("provider"), str) else None,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            arguments=arguments,
            result=result,
            usage=None,
            metadata=metadata,
        )

    def _timeline_response_from_payload(
        self,
        *,
        machine_id: str,
        payload: dict[str, Any],
    ) -> AiControlTimelineResponse | None:
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, str) and self._is_agent_not_found_error(error):
            return None
        if isinstance(error, str) and error:
            raise AiControlBridgeProtocolError(error)

        snapshot = payload.get("agent") if isinstance(payload, dict) else None
        if not isinstance(snapshot, dict):
            return None

        entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
        items = [
            item
            for item in (self._timeline_item_out(entry) for entry in entries if isinstance(entry, dict))
            if item is not None
        ]

        start_cursor = payload.get("startCursor") if isinstance(payload.get("startCursor"), dict) else None
        end_cursor = payload.get("endCursor") if isinstance(payload.get("endCursor"), dict) else None

        return AiControlTimelineResponse(
            session=self._session_out_from_snapshot(machine_id, snapshot),
            page=AiControlTimelinePageOut(
                items=items,
                next_cursor=self._encode_cursor(end_cursor) if bool(payload.get("hasNewer", False)) else None,
                prev_cursor=self._encode_cursor(start_cursor) if bool(payload.get("hasOlder", False)) else None,
                has_more_before=bool(payload.get("hasOlder", False)),
                has_more_after=bool(payload.get("hasNewer", False)),
            ),
        )

    def _normalize_history_preview(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None

        normalized = self._history_preview_excerpt(value)
        if not normalized:
            return None

        if len(normalized) <= self._HISTORY_PREVIEW_TEXT_LIMIT:
            return normalized

        clipped = normalized[: self._HISTORY_PREVIEW_TEXT_LIMIT - 1].rstrip()
        return f"{clipped}…"

    def _history_preview_excerpt(self, value: str) -> str | None:
        cleaned = value.replace("\r\n", "\n").replace("\r", "\n")
        cleaned = re.sub(r"```.*?```", " 代码片段 ", cleaned, flags=re.DOTALL)
        cleaned = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", cleaned)
        cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)

        lines: list[str] = []
        for raw_line in cleaned.split("\n"):
            line = raw_line.strip()
            if not line:
                continue

            line = re.sub(r"^#{1,6}\s*", "", line)
            line = re.sub(r"^>+\s*", "", line)
            line = re.sub(r"^[-*+]\s+", "", line)
            line = re.sub(r"^\d+[.)]\s+", "", line)
            line = line.replace("**", "").replace("__", "").replace("~~", "")
            line = " ".join(line.split())
            if line:
                lines.append(line)

        if not lines:
            return None

        candidate = lines[0]
        if (
            len(candidate) < self._HISTORY_PREVIEW_LINE_JOIN_THRESHOLD
            and len(lines) > 1
            and not candidate.endswith((":", "："))
        ):
            candidate = f"{candidate} {lines[1]}"

        return " ".join(candidate.split()) or None

    def _history_item_out(self, machine_id: str, entry: dict[str, Any]) -> AiControlHistoryItemOut | None:
        agent = entry.get("agent")
        if not isinstance(agent, dict):
            return None

        last_message_preview = self._normalize_history_preview(entry.get("lastMessage"))

        return AiControlHistoryItemOut(
            agent_id=str(agent.get("id") or ""),
            machine_id=machine_id,
            provider=str(agent.get("provider") or ""),
            title=agent.get("title") if isinstance(agent.get("title"), str) else None,
            cwd=str(agent.get("cwd") or ""),
            status=str(agent.get("status") or "unknown"),
            created_at=self._parse_timestamp(agent.get("createdAt")),
            updated_at=self._parse_timestamp(agent.get("updatedAt")),
            last_message_preview=last_message_preview,
            attention=bool(agent.get("requiresAttention", False)),
            attention_reason=agent.get("attentionReason") if isinstance(agent.get("attentionReason"), str) else None,
            persistence_handle=self._persistence_handle_out(agent.get("persistence")),
        )

    @staticmethod
    def _history_entry_agent_id(entry: dict[str, Any]) -> str | None:
        agent = entry.get("agent")
        if not isinstance(agent, dict):
            return None
        agent_id = agent.get("id")
        if not isinstance(agent_id, str) or not agent_id:
            return None
        return agent_id

    def _closed_history_candidates(
        self,
        machine_id: str,
        entries: list[dict[str, Any]],
        *,
        provider: str | None,
    ) -> list[AiControlHistoryItemOut]:
        candidates: list[AiControlHistoryItemOut] = []
        for entry in entries:
            item = self._history_item_out(machine_id, entry)
            if item is None:
                continue
            if provider is not None and item.provider != provider:
                continue
            if item.status.strip().lower() != "closed":
                continue
            candidates.append(item)
        return candidates

    def _machine_payload(
        self,
        machine: Machine,
        *,
        daemon_reachable: bool = False,
        last_daemon_seen_at: dt.datetime | None = None,
    ) -> AiControlMachineOut:
        daemon_url = self._daemon_url_for_machine(machine.id)
        return AiControlMachineOut(
            id=machine.id,
            name=machine.name,
            machine_type=machine.machine_type,
            os_info=machine.os_info,
            is_online=machine.is_online,
            daemon_reachable=daemon_reachable,
            daemon_url=daemon_url,
            runtime_kind="paseo",
            last_heartbeat=machine.last_heartbeat,
            last_daemon_seen_at=last_daemon_seen_at,
        )

    def list_machines(self, db: Session) -> list[AiControlMachineOut]:
        machines = db.query(Machine).order_by(Machine.name).all()
        payloads: list[AiControlMachineOut] = []

        for machine in machines:
            daemon_url = self._daemon_url_for_machine(machine.id)
            daemon_reachable = False
            last_daemon_seen_at = None
            if daemon_url:
                daemon_reachable, last_daemon_seen_at = self._probe_daemon(daemon_url)

            payloads.append(
                self._machine_payload(
                    machine,
                    daemon_reachable=daemon_reachable,
                    last_daemon_seen_at=last_daemon_seen_at,
                )
            )

        return payloads

    def create_session(self, body: AiControlCreateSessionBody, db: Session) -> AiControlSessionOut:
        machine = db.query(Machine).filter(Machine.id == body.machine_id).first()
        if not machine:
            raise HTTPException(404, "机器不存在")

        daemon_url = self._daemon_url_for_machine(body.machine_id)
        if not daemon_url:
            raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

        try:
            snapshot = self._run_async(self._create_agent(daemon_url, body))
        except AiControlBridgeTimeoutError as exc:
            raise HTTPException(504, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(412, str(exc)) from exc
        except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
            raise HTTPException(502, str(exc)) from exc

        return self._session_out_from_snapshot(body.machine_id, snapshot)

    def resume_session(self, body: AiControlResumeSessionBody, db: Session) -> AiControlSessionOut:
        machine = db.query(Machine).filter(Machine.id == body.machine_id).first()
        if not machine:
            raise HTTPException(404, "机器不存在")

        daemon_url = self._daemon_url_for_machine(body.machine_id)
        if not daemon_url:
            raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

        try:
            snapshot = self._run_async(self._resume_agent(daemon_url, body))
        except AiControlBridgeTimeoutError as exc:
            raise HTTPException(504, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(412, str(exc)) from exc
        except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
            raise HTTPException(502, str(exc)) from exc

        return self._session_out_from_snapshot(body.machine_id, snapshot)

    def send_message(
        self,
        *,
        agent_id: str,
        body: AiControlSendMessageBody,
        db: Session,
        machine_id: str | None = None,
    ) -> AiControlSendMessageResponse:
        session = self.get_session(agent_id=agent_id, machine_id=machine_id, db=db)
        machine = db.query(Machine).filter(Machine.id == session.machine_id).first()
        if not machine:
            raise HTTPException(404, "机器不存在")

        daemon_url = self._daemon_url_for_machine(machine.id)
        if not daemon_url:
            raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

        try:
            payload = self._run_async(
                self._send_agent_message(
                    daemon_url,
                    agent_id=agent_id,
                    body=body,
                )
            )
        except AiControlBridgeTimeoutError as exc:
            raise HTTPException(504, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(412, str(exc)) from exc
        except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
            raise HTTPException(502, str(exc)) from exc

        accepted = bool(payload.get("accepted", False))
        error = payload.get("error") if isinstance(payload.get("error"), str) else None
        if not accepted:
            if self._is_agent_not_found_error(error):
                raise HTTPException(404, error or f"会话不存在: {agent_id}")
            raise HTTPException(409, error or f"会话当前状态不允许发送消息: {agent_id}")

        request_id = payload.get("requestId") if isinstance(payload.get("requestId"), str) else ""
        resolved_agent_id = payload.get("agentId") if isinstance(payload.get("agentId"), str) else agent_id
        return AiControlSendMessageResponse(
            accepted=True,
            request_id=request_id,
            agent_id=resolved_agent_id,
        )

    def _get_session_from_machine(
        self,
        *,
        machine: Machine,
        agent_id: str,
    ) -> AiControlSessionOut | None:
        daemon_url = self._daemon_url_for_machine(machine.id)
        if not daemon_url:
            return None

        payload = self._run_async(
            self._fetch_agent_timeline(
                daemon_url,
                agent_id=agent_id,
                limit=0,
                projection="projected",
                direction="tail",
            )
        )
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, str) and self._is_agent_not_found_error(error):
            return None
        if isinstance(error, str) and error:
            raise AiControlBridgeProtocolError(error)

        snapshot = payload.get("agent") if isinstance(payload, dict) else None
        if not isinstance(snapshot, dict):
            return None

        return self._session_out_from_snapshot(machine.id, snapshot)

    def _get_timeline_from_machine(
        self,
        *,
        machine: Machine,
        agent_id: str,
        cursor: str | None,
        direction: str,
        limit: int,
        projection: str,
    ) -> AiControlTimelineResponse | None:
        daemon_url = self._daemon_url_for_machine(machine.id)
        if not daemon_url:
            return None

        resolved_cursor = self._decode_cursor(cursor)
        payload = self._run_async(
            self._fetch_agent_timeline(
                daemon_url,
                agent_id=agent_id,
                cursor=resolved_cursor,
                direction=self._daemon_timeline_direction(direction, resolved_cursor is not None),
                limit=limit,
                projection=self._daemon_timeline_projection(projection),
            )
        )
        return self._timeline_response_from_payload(machine_id=machine.id, payload=payload)

    def _get_history_from_machine(
        self,
        *,
        machine: Machine,
        provider: str | None,
        status: str | None,
        cursor: str | None,
        limit: int,
    ) -> AiControlHistoryResponse:
        daemon_url = self._daemon_url_for_machine(machine.id)
        if not daemon_url:
            raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

        payload = self._run_async(
            self._fetch_agent_history(
                daemon_url,
                status=status,
                cursor=cursor,
                limit=limit,
            )
        )
        entries = [entry for entry in payload.get("entries", []) if isinstance(entry, dict)]
        items = [
            item
            for item in (self._history_item_out(machine.id, entry) for entry in entries)
            if item is not None and (provider is None or item.provider == provider)
        ]
        page_info = payload.get("pageInfo") if isinstance(payload.get("pageInfo"), dict) else {}
        return AiControlHistoryResponse(
            items=items,
            next_cursor=page_info.get("nextCursor") if isinstance(page_info.get("nextCursor"), str) else None,
        )

    def get_session(
        self,
        *,
        agent_id: str,
        db: Session,
        machine_id: str | None = None,
    ) -> AiControlSessionOut:
        if machine_id:
            machine = db.query(Machine).filter(Machine.id == machine_id).first()
            if not machine:
                raise HTTPException(404, "机器不存在")

            daemon_url = self._daemon_url_for_machine(machine.id)
            if not daemon_url:
                raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

            try:
                session = self._get_session_from_machine(machine=machine, agent_id=agent_id)
            except AiControlBridgeTimeoutError as exc:
                raise HTTPException(504, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(412, str(exc)) from exc
            except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
                raise HTTPException(502, str(exc)) from exc

            if session is None:
                raise HTTPException(404, f"会话不存在: {agent_id}")
            return session

        machines = db.query(Machine).order_by(Machine.name).all()
        if not machines:
            raise HTTPException(404, "机器不存在")

        first_error: HTTPException | None = None
        for machine in machines:
            daemon_url = self._daemon_url_for_machine(machine.id)
            if not daemon_url:
                continue
            try:
                session = self._get_session_from_machine(machine=machine, agent_id=agent_id)
            except AiControlBridgeTimeoutError as exc:
                if first_error is None:
                    first_error = HTTPException(504, str(exc))
                continue
            except ValueError as exc:
                if first_error is None:
                    first_error = HTTPException(412, str(exc))
                continue
            except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
                if first_error is None:
                    first_error = HTTPException(502, str(exc))
                continue

            if session is not None:
                return session

        if first_error is not None:
            raise first_error
        raise HTTPException(404, f"会话不存在: {agent_id}")

    def get_timeline(
        self,
        *,
        agent_id: str,
        db: Session,
        machine_id: str | None,
        cursor: str | None,
        direction: str,
        limit: int,
        projection: str,
    ) -> AiControlTimelineResponse:
        if machine_id:
            machine = db.query(Machine).filter(Machine.id == machine_id).first()
            if not machine:
                raise HTTPException(404, "机器不存在")

            daemon_url = self._daemon_url_for_machine(machine.id)
            if not daemon_url:
                raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

            try:
                timeline = self._get_timeline_from_machine(
                    machine=machine,
                    agent_id=agent_id,
                    cursor=cursor,
                    direction=direction,
                    limit=limit,
                    projection=projection,
                )
            except AiControlBridgeTimeoutError as exc:
                raise HTTPException(504, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(412, str(exc)) from exc
            except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
                raise HTTPException(502, str(exc)) from exc

            if timeline is None:
                raise HTTPException(404, f"会话不存在: {agent_id}")
            return timeline

        machines = db.query(Machine).order_by(Machine.name).all()
        if not machines:
            raise HTTPException(404, "机器不存在")

        first_error: HTTPException | None = None
        for machine in machines:
            daemon_url = self._daemon_url_for_machine(machine.id)
            if not daemon_url:
                continue
            try:
                timeline = self._get_timeline_from_machine(
                    machine=machine,
                    agent_id=agent_id,
                    cursor=cursor,
                    direction=direction,
                    limit=limit,
                    projection=projection,
                )
            except AiControlBridgeTimeoutError as exc:
                if first_error is None:
                    first_error = HTTPException(504, str(exc))
                continue
            except ValueError as exc:
                if first_error is None:
                    first_error = HTTPException(412, str(exc))
                continue
            except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
                if first_error is None:
                    first_error = HTTPException(502, str(exc))
                continue

            if timeline is not None:
                return timeline

        if first_error is not None:
            raise first_error
        raise HTTPException(404, f"会话不存在: {agent_id}")

    def get_history(
        self,
        *,
        db: Session,
        machine_id: str | None,
        provider: str | None,
        status: str | None,
        cursor: str | None,
        limit: int,
    ) -> AiControlHistoryResponse:
        if machine_id:
            machine = db.query(Machine).filter(Machine.id == machine_id).first()
            if not machine:
                raise HTTPException(404, "机器不存在")
            try:
                return self._get_history_from_machine(
                    machine=machine,
                    provider=provider,
                    status=status,
                    cursor=cursor,
                    limit=limit,
                )
            except AiControlBridgeTimeoutError as exc:
                raise HTTPException(504, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(412, str(exc)) from exc
            except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
                raise HTTPException(502, str(exc)) from exc

        if cursor:
            raise HTTPException(400, "跨机器 history 分页暂不支持 cursor，请先指定 machine_id")

        machines = db.query(Machine).order_by(Machine.name).all()
        if not machines:
            raise HTTPException(404, "机器不存在")

        first_error: HTTPException | None = None
        aggregated_items: list[AiControlHistoryItemOut] = []
        for machine in machines:
            daemon_url = self._daemon_url_for_machine(machine.id)
            if not daemon_url:
                continue
            try:
                response = self._get_history_from_machine(
                    machine=machine,
                    provider=provider,
                    status=status,
                    cursor=None,
                    limit=limit,
                )
            except AiControlBridgeTimeoutError as exc:
                if first_error is None:
                    first_error = HTTPException(504, str(exc))
                continue
            except ValueError as exc:
                if first_error is None:
                    first_error = HTTPException(412, str(exc))
                continue
            except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
                if first_error is None:
                    first_error = HTTPException(502, str(exc))
                continue

            aggregated_items.extend(response.items)

        if aggregated_items:
            aggregated_items.sort(key=lambda item: item.updated_at, reverse=True)
            return AiControlHistoryResponse(items=aggregated_items[:limit], next_cursor=None)

        if first_error is not None:
            raise first_error
        return AiControlHistoryResponse(items=[], next_cursor=None)

    def backfill_history_previews(
        self,
        *,
        body: AiControlBackfillHistoryPreviewsBody,
        db: Session,
    ) -> AiControlBackfillHistoryPreviewsResponse:
        machine = db.query(Machine).filter(Machine.id == body.machine_id).first()
        if not machine:
            raise HTTPException(404, "机器不存在")

        daemon_url = self._daemon_url_for_machine(machine.id)
        if not daemon_url:
            raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

        try:
            payload = self._run_async(
                self._fetch_agent_history(
                    daemon_url,
                    status="closed",
                    cursor=None,
                    limit=body.limit,
                )
            )
        except AiControlBridgeTimeoutError as exc:
            raise HTTPException(504, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(412, str(exc)) from exc
        except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
            raise HTTPException(502, str(exc)) from exc

        entries = [entry for entry in payload.get("entries", []) if isinstance(entry, dict)]
        candidates = [
            item
            for item in self._closed_history_candidates(machine.id, entries, provider=body.provider)
            if item.last_message_preview is None and item.persistence_handle is not None
        ]

        results: list[AiControlBackfillHistoryPreviewResult] = []
        backfilled_count = 0
        for item in candidates:
            try:
                payload = self._run_async(
                    self._backfill_agent_preview(
                        daemon_url,
                        agent_id=item.agent_id,
                    )
                )
            except AiControlBridgeTimeoutError as exc:
                raise HTTPException(504, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(412, str(exc)) from exc
            except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
                raise HTTPException(502, str(exc)) from exc

            preview = self._normalize_history_preview(payload.get("lastMessage"))
            backfilled = bool(payload.get("backfilled", False)) and preview is not None
            if backfilled:
                backfilled_count += 1
            results.append(
                AiControlBackfillHistoryPreviewResult(
                    agent_id=item.agent_id,
                    title=item.title,
                    backfilled=backfilled,
                    last_message_preview=preview,
                )
            )

        history = self.get_history(
            machine_id=body.machine_id,
            provider=body.provider,
            status=None,
            cursor=None,
            limit=body.limit,
            db=db,
        )
        return AiControlBackfillHistoryPreviewsResponse(
            machine_id=body.machine_id,
            attempted=len(candidates),
            backfilled=backfilled_count,
            skipped=max(len(self._closed_history_candidates(machine.id, entries, provider=body.provider)) - len(candidates), 0),
            results=results,
            history=history,
        )

    def respond_permission(
        self,
        *,
        agent_id: str,
        request_id: str,
        body: AiControlPermissionBody,
        db: Session,
        machine_id: str | None = None,
    ) -> AiControlPermissionResponse:
        session = self.get_session(agent_id=agent_id, machine_id=machine_id, db=db)
        machine = db.query(Machine).filter(Machine.id == session.machine_id).first()
        if not machine:
            raise HTTPException(404, "机器不存在")

        daemon_url = self._daemon_url_for_machine(machine.id)
        if not daemon_url:
            raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

        try:
            payload = self._run_async(
                self._respond_to_permission(
                    daemon_url,
                    agent_id=agent_id,
                    request_id=request_id,
                    body=body,
                )
            )
        except AiControlBridgeTimeoutError as exc:
            raise HTTPException(504, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(412, str(exc)) from exc
        except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
            if self._is_agent_not_found_error(str(exc)):
                raise HTTPException(404, str(exc)) from exc
            raise HTTPException(502, str(exc)) from exc

        resolution = payload.get("resolution") if isinstance(payload.get("resolution"), dict) else None
        resolved: AiControlPermissionResolvedOut | None = None
        if resolution is not None:
            resolved = AiControlPermissionResolvedOut(
                request_id=payload.get("requestId") if isinstance(payload.get("requestId"), str) else request_id,
                agent_id=payload.get("agentId") if isinstance(payload.get("agentId"), str) else agent_id,
                behavior=str(resolution.get("behavior") or body.behavior),
                selected_action_id=(
                    resolution.get("selectedActionId")
                    if isinstance(resolution.get("selectedActionId"), str)
                    else None
                ),
            )

        return AiControlPermissionResponse(ok=True, resolved=resolved)

    def list_providers(self, machine_id: str, db: Session, cwd: str | None = None) -> AiControlProvidersResponse:
        machine = db.query(Machine).filter(Machine.id == machine_id).first()
        if not machine:
            raise HTTPException(404, "机器不存在")

        daemon_url = self._daemon_url_for_machine(machine_id)
        if not daemon_url:
            raise HTTPException(412, "该机器尚未配置 paseo daemon 地址")

        availability_request_id = self._next_request_id("providers")
        snapshot_request_id = self._next_request_id("providers-snapshot")

        try:
            _, responses = self._run_async(
                self._connect_and_exchange(
                    daemon_url,
                    [
                        (
                            {
                                "type": "list_available_providers_request",
                                "requestId": availability_request_id,
                            },
                            "list_available_providers_response",
                        ),
                        (
                            {
                                "type": "get_providers_snapshot_request",
                                "requestId": snapshot_request_id,
                                **({"cwd": cwd} if cwd else {}),
                            },
                            "get_providers_snapshot_response",
                        ),
                    ],
                )
            )
        except AiControlBridgeTimeoutError as exc:
            raise HTTPException(504, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(412, str(exc)) from exc
        except (AiControlBridgeTransportError, AiControlBridgeProtocolError) as exc:
            raise HTTPException(502, str(exc)) from exc

        availability_payload, snapshot_payload = responses
        availability_entries = availability_payload.get("providers")
        snapshot_entries = snapshot_payload.get("entries")

        availability_by_provider = {
            entry.get("provider"): entry
            for entry in availability_entries or []
            if isinstance(entry, dict) and entry.get("provider")
        }
        snapshot_by_provider = {
            entry.get("provider"): entry
            for entry in snapshot_entries or []
            if isinstance(entry, dict) and entry.get("provider")
        }

        provider_ids = sorted(set(snapshot_by_provider) | set(availability_by_provider))
        now = dt.datetime.now(dt.timezone.utc)
        fetched_at = snapshot_payload.get("generatedAt") or availability_payload.get("fetchedAt")

        return AiControlProvidersResponse(
            machine=self._machine_payload(
                machine,
                daemon_reachable=True,
                last_daemon_seen_at=now,
            ),
            providers=[
                self._provider_out(
                    provider_id,
                    snapshot_by_provider.get(provider_id),
                    availability_by_provider.get(provider_id),
                    default_fetched_at=fetched_at,
                )
                for provider_id in provider_ids
            ],
            snapshot_version=snapshot_payload.get("generatedAt"),
            fetched_at=now,
        )

    @staticmethod
    def not_implemented(detail: str) -> HTTPException:
        return HTTPException(501, detail)


bridge_service = AiControlBridgeService()