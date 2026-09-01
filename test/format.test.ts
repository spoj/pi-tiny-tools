import assert from "node:assert/strict";
import test from "node:test";
import { customSummary, renderCustomRow, renderToolRow, resultChars, textContent, toolInvocation } from "../src/format.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

test("extracts text without changing non-text blocks", () => {
  const content = [{ type: "text", text: "one" }, { type: "image", data: "abc" }, { type: "text", text: "two" }];
  assert.equal(textContent(content), "one\ntwo");
  assert.deepEqual(content, [{ type: "text", text: "one" }, { type: "image", data: "abc" }, { type: "text", text: "two" }]);
});

test("uses Pi's call renderer for arbitrary tools", () => {
  const row = {
    toolName: "anything",
    args: { ignored: true },
    callRendererComponent: { render: () => ["• anything useful"] },
  };
  assert.equal(toolInvocation(row), "anything useful");
});

test("strips terminal control sequences from tool invocations", () => {
  const row = {
    toolName: "anything",
    callRendererComponent: { render: () => ["\x1b[?25l\x1b[1;1f• anything useful"] },
  };
  assert.equal(toolInvocation(row), "anything useful");
});

test("renders shell calls like normal tool calls", () => {
  const row = {
    toolName: "bash",
    callRendererComponent: { render: () => ["$ git status", "second line"] },
  };
  assert.equal(toolInvocation(row), "bash git status");
});

test("falls back to tool name and JSON arguments", () => {
  assert.equal(toolInvocation({ toolName: "mcp", args: { query: "hello" } }), 'mcp {"query":"hello"}');
});

test("counts only tool-result text", () => {
  assert.equal(resultChars({ result: { content: [{ type: "text", text: "abc" }, { type: "image" }] } }), 3);
  assert.equal(resultChars({}), undefined);
});

test("tool rows are compact, width safe, and truncate overflow at the end", () => {
  const row = {
    toolName: "read",
    args: { path: "/a/very/long/path/to/file.ts" },
    result: { content: [{ type: "text", text: "x".repeat(1200) }], isError: false },
    isPartial: false,
  };
  const lines = renderToolRow(row, 40);
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes("▏"));
  assert.ok(lines[0].includes("1.2k ch"));
  assert.ok(lines[0].includes('read {"path":"/a/very/'));
  assert.ok(!lines[0].includes("file.ts"));
  assert.ok(visibleWidth(lines[0]) <= 40);
});

test("tool marker and name share the status color while details stay muted", () => {
  const colors: Array<[string, string]> = [];
  const theme = {
    fg(color: string, text: string) {
      colors.push([color, text]);
      return text;
    },
  } as unknown as Theme;
  const callRendererComponent = { render: () => ["$ git status"] };
  renderToolRow({ toolName: "bash", callRendererComponent, result: { content: [], isError: false } }, 80, theme);
  renderToolRow({ toolName: "bash", callRendererComponent, result: { content: [], isError: true } }, 80, theme);
  assert.ok(colors.some(([color, text]) => color === "success" && text === "›"));
  assert.ok(colors.some(([color, text]) => color === "success" && text === "bash"));
  assert.ok(colors.some(([color, text]) => color === "error" && text === "›"));
  assert.ok(colors.some(([color, text]) => color === "error" && text === "bash"));
  assert.ok(colors.some(([color, text]) => color === "muted" && text === " git status"));
});

test("long streaming tool calls keep their visible text stable", () => {
  const first = renderToolRow({ toolName: "tool", args: { text: "x".repeat(100) } }, 30);
  const updated = renderToolRow({ toolName: "tool", args: { text: `${"x".repeat(100)}changing tail` } }, 30);
  assert.deepEqual(updated, first);
});

test("image results show their media type instead of zero characters", () => {
  const lines = renderToolRow({
    toolName: "image_tool",
    result: { content: [{ type: "image", mimeType: "image/png" }], isError: false },
    isPartial: false,
  }, 50);
  assert.ok(lines[0].includes("png"));
  assert.ok(!lines[0].includes("0 ch"));
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
