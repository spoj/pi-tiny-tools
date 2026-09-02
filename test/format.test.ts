import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCustomRow, renderToolRow, renderTraceGroup } from "../src/format.ts";

test("tool and custom rows show only their names", () => {
  assert.deepEqual(renderToolRow({ toolName: "read", result: { isError: false } }, 40), [" › read"]);
  assert.deepEqual(renderCustomRow({ message: { customType: "pi-subagents" } }, 40), [" › pi-subagents"]);
});

test("trace groups wrap tool and custom names together", () => {
  const lines = renderTraceGroup([
    { toolName: "read" },
    { toolName: "bash" },
    { traceKind: "thinking" },
    { message: { customType: "pi-subagents" } },
    { toolName: "write" },
  ], 24);
  assert.deepEqual(lines, [" › read bash think", "   pi-subagents write"]);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
});

test("trace names retain their individual colors and use a dim marker", () => {
  const colors: Array<[string, string]> = [];
  const theme = {
    fg(color: string, text: string) {
      colors.push([color, text]);
      return text;
    },
  } as unknown as Theme;
  renderTraceGroup([
    { toolName: "pending" },
    { toolName: "done", result: { isError: false } },
    { toolName: "failed", result: { isError: true } },
    { traceKind: "thinking" },
    { message: { customType: "extension" } },
  ], 80, theme);
  assert.ok(colors.some(([color, text]) => color === "dim" && text === "›"));
  assert.ok(colors.some(([color, text]) => color === "accent" && text === "pending"));
  assert.ok(colors.some(([color, text]) => color === "success" && text === "done"));
  assert.ok(colors.some(([color, text]) => color === "error" && text === "failed"));
  assert.ok(colors.some(([color, text]) => color === "thinkingText" && text === "think"));
  assert.ok(colors.some(([color, text]) => color === "customMessageLabel" && text === "extension"));
});
