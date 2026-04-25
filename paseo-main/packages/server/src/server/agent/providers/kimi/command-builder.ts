import type { AgentPersistenceHandle, AgentPromptInput } from "../../agent-sdk-types.js";
import {
  resolveProviderCommandPrefix,
  type ProviderCommandPrefix,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";

export interface BuildKimiArgsOptions {
  prompt: AgentPromptInput;
  cwd: string;
  modeId?: string | null;
  resumeHandle?: AgentPersistenceHandle | null;
}

export function promptToKimiText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }

  return prompt
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if ("name" in block && typeof block.name === "string") {
        return `[attachment:${block.name}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function buildKimiCommandPrefix(
  runtimeSettings?: ProviderRuntimeSettings,
): Promise<ProviderCommandPrefix> {
  return await resolveProviderCommandPrefix(runtimeSettings?.command, async () => "kimi");
}

export function buildKimiArgs(options: BuildKimiArgsOptions): string[] {
  const promptText = promptToKimiText(options.prompt);
  const args = ["--print", "-p", promptText, "--output-format", "stream-json"];

  if (options.cwd) {
    args.push("-w", options.cwd);
  }

  if (options.resumeHandle?.sessionId) {
    args.push("-r", options.resumeHandle.sessionId);
  } else if (options.modeId === "plan") {
    args.push("--plan");
  } else if (options.modeId === "continue") {
    args.push("-C");
  }

  return args;
}