import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";

import { KimiAgentClient } from "./kimi-agent.js";

const originalKimiShareDir = process.env.KIMI_SHARE_DIR;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeKimiContextFile(
  shareDir: string,
  cwd: string,
  sessionId: string,
  lines: string[],
): void {
  const workDirHash = createHash("md5").update(cwd).digest("hex");
  const sessionDir = join(shareDir, "sessions", workDirHash, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "context.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

afterEach(() => {
  process.env.KIMI_SHARE_DIR = originalKimiShareDir;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("KimiAgentSession.streamHistory", () => {
  test("replays persisted context messages for resumed sessions", async () => {
    const shareDir = makeTempDir("kimi-agent-share-");
    process.env.KIMI_SHARE_DIR = shareDir;

    const cwd = "/tmp/kimi-history-workdir";
    const sessionId = "12345678-1234-4234-9234-1234567890ab";
    writeKimiContextFile(shareDir, cwd, sessionId, [
      JSON.stringify({ role: "_system_prompt", content: "ignore me" }),
      JSON.stringify({ role: "user", content: "Hello from user" }),
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "think", think: "hidden reasoning" },
          { type: "text", text: "Recovered assistant reply" },
        ],
      }),
    ]);

    const client = new KimiAgentClient({ logger: createTestLogger() });
    const session = await client.resumeSession({
      provider: "kimi",
      sessionId,
      metadata: { cwd },
    });

    const historyEvents = [];
    for await (const event of session.streamHistory()) {
      historyEvents.push(event);
    }

    expect(historyEvents).toEqual([
      {
        type: "timeline",
        provider: "kimi",
        item: { type: "user_message", text: "Hello from user" },
      },
      {
        type: "timeline",
        provider: "kimi",
        item: { type: "assistant_message", text: "Recovered assistant reply" },
      },
    ]);
  });
});