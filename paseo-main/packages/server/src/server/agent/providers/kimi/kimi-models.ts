import type { AgentModelDefinition } from "../../agent-sdk-types.js";

export const KIMI_DEFAULT_MODEL_ID = "auto";

const KIMI_MODELS: AgentModelDefinition[] = [
  {
    provider: "kimi",
    id: KIMI_DEFAULT_MODEL_ID,
    label: "Auto",
    description: "Use the Kimi Code CLI default model selection.",
    isDefault: true,
  },
];

export function getKimiModels(): AgentModelDefinition[] {
  return KIMI_MODELS;
}

export function normalizeKimiRuntimeModelId(model: string | null | undefined): string | null {
  if (!model || !model.trim()) {
    return KIMI_DEFAULT_MODEL_ID;
  }
  return model.trim();
}