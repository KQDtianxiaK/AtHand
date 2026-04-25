import { describe, expect, it } from "vitest";

import { translateKimiJsonLine } from "./event-translator.js";

describe("translateKimiJsonLine", () => {
  it("splits assistant think and text blocks from structured content arrays", () => {
    const result = translateKimiJsonLine(
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "think", think: "The user wants exactly READY." },
          { type: "text", text: "READY" },
        ],
      }),
    );

    expect(result.items).toEqual([
      { type: "reasoning", text: "The user wants exactly READY." },
      { type: "assistant_message", text: "READY" },
    ]);
  });

  it("preserves plain assistant text when content is not structured", () => {
    const result = translateKimiJsonLine(
      JSON.stringify({
        role: "assistant",
        content: "READY",
      }),
    );

    expect(result.items).toEqual([{ type: "assistant_message", text: "READY" }]);
  });
});