import assert from "node:assert/strict";
import test from "node:test";
import { InteractiveMode, SessionManager, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import tinyTools from "../src/index.ts";

test("transcript keeps the full active branch across compaction, reload, and tree navigation", async (t) => {
  const prototype = InteractiveMode.prototype as unknown as {
    renderSessionEntries(entries: SessionEntry[], options?: unknown): void;
    renderInitialMessages(): void;
    rebuildChatFromMessages(): void;
    handleEvent(event: unknown): Promise<void>;
  };
  const nativeRender = prototype.renderSessionEntries;
  let shutdown: () => void;
  tinyTools({
    on(name: string, handler: (event?: unknown, ctx?: unknown) => void) {
      if (name === "session_start") handler({}, { mode: "tui", ui: { setHiddenThinkingLabel() {} } });
      if (name === "session_shutdown") shutdown = handler;
    },
    registerCommand() {},
    registerShortcut() {},
  } as unknown as ExtensionAPI);
  t.after(() => {
    shutdown();
    assert.equal(prototype.renderSessionEntries, nativeRender);
  });

  const sessionManager = SessionManager.inMemory();
  const first = sessionManager.appendMessage({ role: "user", content: "old request", timestamp: 1 });
  const kept = sessionManager.appendMessage({ role: "user", content: "recent request", timestamp: 2 });
  const items: unknown[] = [];
  const interactive = {
    isInitialized: true,
    renderSessionEntries: prototype.renderSessionEntries,
    sessionManager,
    renderSessionItems(rendered: unknown[]) { items.push(...rendered); },
    addMessageToChat(message: unknown) { items.push(message); },
    chatContainer: { clear() { items.length = 0; }, children: items },
    settingsManager: { getShowTerminalProgress: () => false },
    clearStatusIndicator() {},
    footer: { invalidate() {} },
    ui: { requestRender() {} },
    flushCompactionQueue() {},
    renderProjectTrustWarningIfNeeded() {},
    showStatus() {},
  };
  const texts = () => items.map((item) => {
    const message = item as { content?: string; summary?: string };
    return message.content ?? message.summary;
  });

  prototype.renderInitialMessages.call(interactive);
  assert.deepEqual(texts(), ["old request", "recent request"]);

  sessionManager.appendCompaction("first summary", kept, 1000);
  const contextBefore = structuredClone(sessionManager.buildSessionContext());
  const entriesBefore = structuredClone(sessionManager.getEntries());
  await prototype.handleEvent.call(interactive, {
    type: "compaction_end",
    reason: "manual",
    result: { summary: "first summary", tokensBefore: 1000 },
  });
  assert.deepEqual(texts(), ["old request", "recent request", "first summary"]);

  items.length = 0;
  prototype.renderInitialMessages.call(interactive);
  assert.deepEqual(texts(), ["old request", "recent request", "first summary"]);
  assert.deepEqual(sessionManager.buildSessionContext(), contextBefore);
  assert.deepEqual(sessionManager.getEntries(), entriesBefore);
  assert.equal(contextBefore.messages.some((message) => message.role === "user" && message.content === "old request"), false);

  const newest = sessionManager.appendMessage({ role: "user", content: "newest request", timestamp: 3 });
  sessionManager.appendCompaction("second summary", newest, 2000);
  await prototype.handleEvent.call(interactive, {
    type: "compaction_end",
    reason: "threshold",
    result: { summary: "second summary", tokensBefore: 2000 },
  });
  const expected = ["old request", "recent request", "first summary", "newest request", "second summary"];
  assert.deepEqual(texts(), expected);
  prototype.rebuildChatFromMessages.call(interactive);
  assert.deepEqual(texts(), expected);

  sessionManager.branch(first);
  sessionManager.appendMessage({ role: "user", content: "other branch", timestamp: 4 });
  prototype.rebuildChatFromMessages.call(interactive);
  assert.deepEqual(texts(), ["old request", "other branch"]);

  sessionManager.newSession();
  prototype.rebuildChatFromMessages.call(interactive);
  assert.deepEqual(items, []);
});

test("a compaction appended at a turn boundary keeps the history once", async (t) => {
  const prototype = InteractiveMode.prototype as unknown as {
    renderInitialMessages(): void;
    handleEvent(event: unknown): Promise<void>;
  };
  let shutdown: () => void;
  tinyTools({
    on(name: string, handler: (event?: unknown, ctx?: unknown) => void) {
      if (name === "session_start") handler({}, { mode: "tui", ui: { setHiddenThinkingLabel() {} } });
      if (name === "session_shutdown") shutdown = handler;
    },
    registerCommand() {},
    registerShortcut() {},
  } as unknown as ExtensionAPI);
  t.after(() => shutdown());

  const sessionManager = SessionManager.inMemory();
  sessionManager.appendMessage({ role: "user", content: "old request", timestamp: 1 });
  const kept = sessionManager.appendMessage({ role: "user", content: "recent request", timestamp: 2 });
  const items: unknown[] = [];
  const interactive = {
    isInitialized: true,
    entriesRenderedByBoundaryCompaction: new Set<string>(),
    renderSessionEntries: (InteractiveMode.prototype as unknown as { renderSessionEntries: unknown }).renderSessionEntries,
    sessionManager,
    renderSessionItems(rendered: unknown[]) { items.push(...rendered); },
    addMessageToChat(message: unknown) { items.push(message); },
    chatContainer: { clear() { items.length = 0; }, children: items },
    footer: { invalidate() {} },
    ui: { requestRender() {} },
    renderProjectTrustWarningIfNeeded() {},
    showStatus() {},
  };
  const texts = () => items.map((item) => {
    const message = item as { content?: string; summary?: string };
    return message.content ?? message.summary;
  });

  prototype.renderInitialMessages.call(interactive);
  const compaction = sessionManager.getEntry(sessionManager.appendCompaction("boundary summary", kept, 1000))!;
  const chained = sessionManager.getEntry(sessionManager.appendCustomMessageEntry("note", "after summary", true))!;
  await prototype.handleEvent.call(interactive, { type: "entry_appended", entry: compaction });
  await prototype.handleEvent.call(interactive, { type: "entry_appended", entry: chained });
  assert.deepEqual(texts(), ["old request", "recent request", "boundary summary", "after summary"]);
});
