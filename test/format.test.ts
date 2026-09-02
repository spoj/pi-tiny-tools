import assert from "node:assert/strict";
import test from "node:test";
import { customSummary, renderCustomRow, renderToolGroup, renderToolRow, textContent } from "../src/format.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

test("extracts text without changing non-text blocks", () => {
  const content = [{ type: "text", text: "one" }, { type: "image", data: "abc" }, { type: "text", text: "two" }];
  assert.equal(textContent(content), "one\ntwo");
  assert.deepEqual(content, [{ type: "text", text: "one" }, { type: "image", data: "abc" }, { type: "text", text: "two" }]);
});

test("tool rows show only the tool name", () => {
  const lines = renderToolRow({ toolName: "read", result: { isError: false }, isPartial: false }, 40);
  assert.deepEqual(lines, ["  › read"]);
});

test("tool groups wrap names onto indented continuation lines", () => {
  const lines = renderToolGroup([
    { toolName: "read" },
    { toolName: "bash" },
    { toolName: "ForkSteer" },
    { toolName: "write" },
  ], 20);
  assert.deepEqual(lines, ["  › read bash", "    ForkSteer write"]);
  assert.ok(lines.every((line) => visibleWidth(line) <= 20));
});

test("tool names retain their individual status colors", () => {
  const colors: Array<[string, string]> = [];
  const theme = {
    fg(color: string, text: string) {
      colors.push([color, text]);
      return text;
    },
  } as unknown as Theme;
  renderToolGroup([
    { toolName: "pending" },
    { toolName: "done", result: { isError: false } },
    { toolName: "failed", result: { isError: true } },
  ], 80, theme);
  assert.ok(colors.some(([color, text]) => color === "accent" && text === "pending"));
  assert.ok(colors.some(([color, text]) => color === "success" && text === "done"));
  assert.ok(colors.some(([color, text]) => color === "error" && text === "failed"));
});

test("custom rows use customType and completion result", () => {
  const row = {
    message: {
      customType: "pi-subagents",
      content: "Subagent completed.\n\nID: agent-1\nResult:\nFinished the work.",
    },
  };
  assert.deepEqual(customSummary(row), {
    label: "pi-subagents",
    text: "Subagent completed. · Result: Finished the work.",
    chars: 59,
  });
  const lines = renderCustomRow(row, 100);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("[pi-subagents]"));
  assert.ok(lines[0].includes("Result: Finished the work."));
});

test("custom row markers and labels stay purple while their text is muted", () => {
  const colors: Array<[string, string]> = [];
  const theme = {
    bold: (text: string) => text,
    fg(color: string, text: string) {
      colors.push([color, text]);
      return text;
    },
  } as unknown as Theme;
  renderCustomRow({ message: { customType: "extension", content: "message" } }, 80, theme);
  assert.ok(colors.some(([color, text]) => color === "customMessageLabel" && text === "›"));
  assert.ok(colors.some(([color, text]) => color === "customMessageLabel" && text === "[extension]"));
  assert.ok(colors.some(([color, text]) => color === "muted" && text === "message"));
});

test("custom rows stay width safe", () => {
  const lines = renderCustomRow({ message: { customType: "extension", content: "x".repeat(500) } }, 32);
  assert.ok(lines.every((line) => visibleWidth(line) <= 32));
});
