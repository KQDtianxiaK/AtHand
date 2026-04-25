import { formatConfiguredCommand, formatProviderDiagnostic, resolveBinaryVersion } from "../diagnostic-utils.js";
import {
  resolveProviderCommandPrefix,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { findExecutable } from "../../../../utils/executable.js";

export async function resolveKimiVersion(runtimeSettings?: ProviderRuntimeSettings): Promise<string> {
  const prefix = await resolveProviderCommandPrefix(runtimeSettings?.command, async () => "kimi");
  const resolvedBinary = (await findExecutable(prefix.command)) ?? prefix.command;
  return await resolveBinaryVersion(resolvedBinary);
}

export async function formatKimiDiagnostic(
  available: boolean,
  runtimeSettings?: ProviderRuntimeSettings,
): Promise<string> {
  const version = available ? await resolveKimiVersion(runtimeSettings) : "unknown";
  return formatProviderDiagnostic("Kimi", [
    { label: "Available", value: available ? "Available" : "Unavailable" },
    { label: "Command", value: formatConfiguredCommand(["kimi", "--print"], runtimeSettings) },
    { label: "Version", value: version },
  ]);
}