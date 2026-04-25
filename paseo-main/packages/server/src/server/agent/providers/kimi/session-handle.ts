import type { AgentPersistenceHandle, AgentSessionConfig } from "../../agent-sdk-types.js";

const SESSION_ID_REGEX = /kimi -r ([0-9a-f-]{36})/i;

export function extractKimiSessionId(stderr: string): string | null {
  const match = SESSION_ID_REGEX.exec(stderr);
  return match?.[1] ?? null;
}

export function buildKimiPersistenceHandle(
  config: AgentSessionConfig,
  sessionId: string,
): AgentPersistenceHandle {
  return {
    provider: "kimi",
    sessionId,
    nativeHandle: sessionId,
    metadata: {
      cwd: config.cwd,
      modeId: config.modeId ?? null,
      model: config.model ?? null,
      title: config.title ?? null,
    },
  };
}

export function coerceKimiResumeMetadata(
  handle: AgentPersistenceHandle,
): Partial<AgentSessionConfig> {
  const metadata = handle.metadata ?? {};
  return {
    provider: "kimi",
    cwd: typeof metadata.cwd === "string" ? metadata.cwd : "",
    modeId: typeof metadata.modeId === "string" ? metadata.modeId : undefined,
    model: typeof metadata.model === "string" ? metadata.model : undefined,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
  };
}