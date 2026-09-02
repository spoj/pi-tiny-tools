import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { ellipsizeId, extractTraceItems, TraceInspector, traceContent } from "../src/trace-inspector.ts";

const base = { parentId: null, timestamp: "2026-01-01T00:00:00.000Z" };

function entries(): SessionEntry[] {
  return [
    {
      ...base,
      type: "message",
      id: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "one.ts" } },
          { type: "thinking", thinking: "Need to run the tests." },
          { type: "toolCall", id: "call-2", name: "bash", arguments: { command: "npm test" } },
        ],
      },
    },
    {
      ...base,
      type: "message",
      id: "result-1",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "first" }, { type: "text", text: "second" }],
        details: { lines: 2 },
        addedToolNames: ["extra"],
        isError: false,
        timestamp: 1,
      },
    },
    {
      ...base,
      type: "message",
      id: "result-2",
      message: {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "bash",
        content: [{ type: "text", text: "failed" }],
        isError: true,
        timestamp: 2,
      },
    },
    {
      ...base,
      type: "custom_message",
      id: "custom",
      customType: "browser",
      content: "hidden context",
      details: { url: "https://example.com" },
      display: false,
    },
  ] as SessionEntry[];
}

const theme = {
  fg(_color: string, text: string) {
    return text;
  },
} as unknown as Theme;

function fakeTui(rows = 14): TUI & { renders: number } {
  const tui = {
    terminal: { rows },
    renders: 0,
    requestRender() {
      tui.renders++;
    },
  };
  return tui as unknown as TUI & { renders: number };
}

test("ellipsizes long ids while retaining both distinguishing ends", () => {
  assert.equal(ellipsizeId("short-id"), "short-id");
  assert.equal(ellipsizeId("call_1234567890abcdef"), "call_…cdef");
});

test("extracts tool calls, pairs results by id, and includes hidden custom messages", () => {
  const items = extractTraceItems(entries());

  assert.deepEqual(items, [
    {
      id: "call-1",
      kind: "tool",
      name: "read",
      status: "success",
      call: { id: "call-1", name: "read", arguments: { path: "one.ts" } },
      output: "first\nsecond",
      result: {
        toolCallId: "call-1",
        toolName: "read",
        isError: false,
        timestamp: 1,
        addedToolNames: ["extra"],
      },
      details: { lines: 2 },
    },
    {
      id: "assistant:thinking:1",
      kind: "thinking",
      name: "think",
      status: "success",
      output: "Need to run the tests.",
    },
    {
      id: "call-2",
      kind: "tool",
      name: "bash",
      status: "error",
      call: { id: "call-2", name: "bash", arguments: { command: "npm test" } },
      output: "failed",
      result: {
        toolCallId: "call-2",
        toolName: "bash",
        isError: true,
        timestamp: 2,
      },
      details: undefined,
    },
    {
      id: "custom",
      kind: "custom",
      name: "browser",
      status: "success",
      hidden: true,
      output: "hidden context",
      details: { url: "https://example.com" },
    },
  ]);
});

test("marks tool calls from aborted and failed assistant messages as errors", () => {
  const items = extractTraceItems([
    {
      ...base,
      type: "message",
      id: "aborted",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "aborted-call", name: "read", arguments: {} }],
        stopReason: "aborted",
      },
    },
    {
      ...base,
      type: "message",
      id: "failed",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "failed-call", name: "bash", arguments: {} }],
        stopReason: "error",
      },
    },
  ] as SessionEntry[]);

  assert.deepEqual(items.map(({ id, status }) => ({ id, status })), [
    { id: "aborted-call", status: "error" },
    { id: "failed-call", status: "error" },
  ]);
});

test("formats all persisted sections", () => {
  assert.deepEqual(traceContent(extractTraceItems(entries())[0]!), [
    "CALL",
    "{",
    '  "id": "call-1",',
    '  "name": "read",',
    '  "arguments": {',
    '    "path": "one.ts"',
    "  }",
    "}",
    "",
    "OUTPUT",
    "first",
    "second",
    "",
    "RESULT",
    "{",
    '  "toolCallId": "call-1",',
    '  "toolName": "read",',
    '  "isError": false,',
    '  "timestamp": 1,',
    '  "addedToolNames": [',
    '    "extra"',
    "  ]",
    "}",
    "",
    "DETAILS",
    "{",
    '  "lines": 2',
    "}",
  ]);
});

test("inspector navigates items, scrolls content, and respects its render width", () => {
  const tui = fakeTui(12);
  let closed = false;
  const items = extractTraceItems(entries());
  items[3]!.output = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
  items[3]!.details = undefined;
  const inspector = new TraceInspector(items, theme, tui, () => { closed = true; });

  let lines = inspector.render(50);
  assert.ok(lines.some((line) => line.includes("trace 4/4") && line.includes("browser") && line.includes("hidden")));
  assert.ok(lines.every((line) => visibleWidth(line) <= 50));

  inspector.handleInput("k");
  lines = inspector.render(50);
  assert.ok(lines.some((line) => line.includes("trace 3/4") && line.includes("bash")));

  inspector.handleInput("j");
  inspector.handleInput("G");
  lines = inspector.render(50);
  assert.ok(lines.some((line) => line.includes("line 11")));

  inspector.updateLiveThinking({
    id: "live-thinking:1",
    kind: "thinking",
    name: "think",
    status: "pending",
    output: "partial thought",
  });
  lines = inspector.render(50);
  assert.ok(lines.some((line) => line.includes("trace 5/5") && line.includes("thinking") && line.includes("pending")));
  assert.ok(lines.some((line) => line.includes("partial thought")));
  assert.equal(tui.renders, 4);

  inspector.handleInput("\x1b");
  assert.equal(closed, true);
});
