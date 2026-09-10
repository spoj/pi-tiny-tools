import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import tinyTools from "../src/index.ts";
import { finishLiveTool, showTraceInspector, startLiveTool } from "../src/trace-inspector.ts";

const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;

type Handler = (event?: unknown, ctx?: unknown) => unknown;

function handlersWithExtension(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerCommand() {},
    registerShortcut() {},
  } as unknown as ExtensionAPI;
  tinyTools(pi);
  handlers.get("session_start")?.({}, { mode: "tui", ui: { setHiddenThinkingLabel() {} } });
  return handlers;
}

function traceContext(entries: unknown[]) {
  const notifications: string[] = [];
  let inspector: { render(width: number): string[] } | undefined;
  const ctx = {
    mode: "tui",
    sessionManager: { getBranch: () => entries },
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
      async custom(factory: (tui: TUI, theme: Theme, keys: unknown, done: () => void) => { render(width: number): string[] }) {
        inspector = factory(
          { terminal: { rows: 14 }, requestRender() {} } as unknown as TUI,
          theme,
          undefined,
          () => {},
        );
      },
    },
  } as unknown as ExtensionContext;
  return { ctx, notifications, inspector: () => inspector };
}

test("finished live tool items are released once their result is persisted", async () => {
  const handlers = handlersWithExtension();

  startLiveTool("call-1", "read", { path: "a.ts" });
  finishLiveTool("call-1", "read", { content: [{ type: "text", text: "done" }] }, false);

  const before = traceContext([]);
  await showTraceInspector(before.ctx);
  assert.match(before.inspector()!.render(60).join("\n"), /trace 1\/1 · tool · read · success/);

  handlers.get("message_end")?.(
    { message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [], isError: false, timestamp: 1 } },
    { mode: "tui" },
  );

  const after = traceContext([]);
  await showTraceInspector(after.ctx);
  assert.deepEqual(after.notifications, ["No traceable items in the current branch"]);
  assert.equal(after.inspector(), undefined);

  handlers.get("session_shutdown")?.();
});

test("branch changes drop live items that are not in the new branch", async () => {
  const handlers = handlersWithExtension();

  startLiveTool("call-2", "bash", { command: "ls" });
  finishLiveTool("call-2", "bash", { content: [{ type: "text", text: "x" }] }, false);

  handlers.get("session_tree")?.({}, { sessionManager: { getBranch: () => [] } });

  const after = traceContext([]);
  await showTraceInspector(after.ctx);
  assert.deepEqual(after.notifications, ["No traceable items in the current branch"]);

  handlers.get("session_shutdown")?.();
});

test("branch changes keep live items that the new branch still references", async () => {
  const handlers = handlersWithExtension();

  startLiveTool("call-3", "read", { path: "b.ts" });
  const entries = [
    {
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "message",
      id: "assistant",
      message: { role: "assistant", content: [{ type: "toolCall", id: "call-3", name: "read", arguments: { path: "b.ts" } }] },
    },
  ];

  handlers.get("session_tree")?.({}, { sessionManager: { getBranch: () => entries } });

  const context = traceContext(entries);
  await showTraceInspector(context.ctx);
  assert.match(context.inspector()!.render(60).join("\n"), /trace 1\/1 · tool · read · pending/);

  handlers.get("session_shutdown")?.();
});
