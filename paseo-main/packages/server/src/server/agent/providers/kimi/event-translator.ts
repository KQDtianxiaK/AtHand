import type { AgentTimelineItem, AgentUsage } from "../../agent-sdk-types.js";

export interface KimiTranslationResult {
  items: AgentTimelineItem[];
  usage?: AgentUsage;
}

function coerceText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => coerceText(entry)).filter(Boolean).join("\n").trim();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (typeof record.content === "string") {
      return record.content.trim();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function translateStructuredContentBlock(
  role: string | null,
  value: unknown,
): AgentTimelineItem[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return [];
    }
    return role === "user"
      ? [{ type: "user_message", text }]
      : [{ type: "assistant_message", text }];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const blockType = typeof record.type === "string" ? record.type : null;
  const text = coerceText(record.text ?? record.content);
  const reasoning = coerceText(record.think ?? record.thinking ?? record.reasoning);

  if (blockType === "think" || blockType === "thinking" || blockType === "reasoning") {
    return reasoning ? [{ type: "reasoning", text: reasoning }] : [];
  }

  if (blockType === "text" || blockType === "output_text") {
    if (!text) {
      return [];
    }
    return role === "user"
      ? [{ type: "user_message", text }]
      : [{ type: "assistant_message", text }];
  }

  if (reasoning && !text) {
    return [{ type: "reasoning", text: reasoning }];
  }

  if (!text) {
    return [];
  }

  return role === "user"
    ? [{ type: "user_message", text }]
    : [{ type: "assistant_message", text }];
}

function translateStructuredContent(
  role: string | null,
  content: unknown,
): AgentTimelineItem[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((entry) => translateStructuredContentBlock(role, entry));
}

function extractUsage(payload: Record<string, unknown>): AgentUsage | undefined {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const data = usage as Record<string, unknown>;
  return {
    inputTokens: typeof data.inputTokens === "number" ? data.inputTokens : undefined,
    outputTokens: typeof data.outputTokens === "number" ? data.outputTokens : undefined,
    totalCostUsd: typeof data.totalCostUsd === "number" ? data.totalCostUsd : undefined,
  };
}

export function mergeKimiUsage(
  existing: AgentUsage | undefined,
  delta: AgentUsage | undefined,
): AgentUsage | undefined {
  if (!existing) {
    return delta;
  }
  if (!delta) {
    return existing;
  }
  return {
    inputTokens: (existing.inputTokens ?? 0) + (delta.inputTokens ?? 0) || undefined,
    outputTokens: (existing.outputTokens ?? 0) + (delta.outputTokens ?? 0) || undefined,
    totalCostUsd: (existing.totalCostUsd ?? 0) + (delta.totalCostUsd ?? 0) || undefined,
    cachedInputTokens: (existing.cachedInputTokens ?? 0) + (delta.cachedInputTokens ?? 0) || undefined,
    contextWindowMaxTokens: delta.contextWindowMaxTokens ?? existing.contextWindowMaxTokens,
    contextWindowUsedTokens: delta.contextWindowUsedTokens ?? existing.contextWindowUsedTokens,
  };
}

export function translateKimiJsonLine(rawLine: string): KimiTranslationResult {
  const parsed = JSON.parse(rawLine) as Record<string, unknown>;
  const payload =
    parsed.message && typeof parsed.message === "object"
      ? (parsed.message as Record<string, unknown>)
      : parsed;
  const items: AgentTimelineItem[] = [];

  const role = typeof payload.role === "string" ? payload.role : null;
  const content = payload.content ?? payload.text;
  const structuredContentItems = translateStructuredContent(role, content);

  if (
    typeof payload.reasoning === "string" &&
    payload.reasoning.trim() &&
    !structuredContentItems.some((item) => item.type === "reasoning")
  ) {
    items.push({ type: "reasoning", text: payload.reasoning.trim() });
  }

  if (Array.isArray(payload.tool_calls)) {
    for (const entry of payload.tool_calls) {
      const record = entry as Record<string, unknown>;
      const callId = typeof record.id === "string" ? record.id : `kimi-tool-${items.length + 1}`;
      const name = typeof record.name === "string" ? record.name : "kimi-tool";
      items.push({
        type: "tool_call",
        callId,
        name,
        status: "completed",
        error: null,
        detail: { type: "unknown", input: record, output: null },
      });
    }
  }

  if (structuredContentItems.length > 0) {
    items.push(...structuredContentItems);
  } else {
    const text = coerceText(content);
    if (role === "user" && text) {
      items.push({ type: "user_message", text });
    } else if (role === "assistant" && text) {
      items.push({ type: "assistant_message", text });
    } else if (typeof payload.error === "string" && payload.error.trim()) {
      items.push({ type: "error", message: payload.error.trim() });
    } else if (text) {
      items.push({ type: "assistant_message", text });
    }
  }

  return {
    items,
    usage: extractUsage(payload),
  };
}

export function translateKimiNonJsonLine(rawLine: string): AgentTimelineItem | null {
  const text = rawLine.trim();
  if (!text) {
    return null;
  }
  return { type: "assistant_message", text };
}