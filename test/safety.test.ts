import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  initTheme,
  SessionManager,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import tinyTools from "../src/index.ts";

test("internal traces stay compact while native expansion state changes", () => {
  initTheme();
  const toolPrototype = ToolExecutionComponent.prototype as unknown as { render: unknown };
  const customPrototype = CustomMessageComponent.prototype as unknown as { render: unknown };
  const assistantPrototype = AssistantMessageComponent.prototype as unknown as {
    render: (this: unknown, width: number) => string[];
    setHideThinkingBlock: (this: unknown, hide: boolean) => void;
    updateContent: (this: unknown, message: unknown, isStreaming?: boolean) => void;
  };
  const userPrototype = UserMessageComponent.prototype as unknown as { render: unknown };
  const containerPrototype = Container.prototype as unknown as { render: unknown };
  const nativeToolRender = toolPrototype.render;
  const nativeCustomRender = customPrototype.render;
  const nativeAssistantRender = assistantPrototype.render;
  const nativeSetHideThinking = assistantPrototype.setHideThinkingBlock;
  const nativeUpdateContent = assistantPrototype.updateContent;
  const nativeUserRender = userPrototype.render;
  const nativeContainerRender = containerPrototype.render;
  const nativeBuildContextEntries = SessionManager.prototype.buildContextEntries;
  const handlers = new Map<string, (event?: unknown, ctx?: unknown) => unknown>();
  const shortcuts = new Map<string, () => void>();
  const pi = {
    on(name: string, handler: (event?: unknown, ctx?: unknown) => unknown) {
      handlers.set(name, handler);
    },
    registerCommand() {},
    registerShortcut(key: string, options: { handler: () => void }) {
      shortcuts.set(key, options.handler);
    },
  } as unknown as ExtensionAPI;

  tinyTools(pi);

  assert.notEqual(toolPrototype.render, nativeToolRender);
  assert.notEqual(customPrototype.render, nativeCustomRender);
  assert.notEqual(assistantPrototype.render, nativeAssistantRender);
  assert.notEqual(assistantPrototype.setHideThinkingBlock, nativeSetHideThinking);
  assert.notEqual(assistantPrototype.updateContent, nativeUpdateContent);
  assert.equal(userPrototype.render, nativeUserRender);
  assert.notEqual(containerPrototype.render, nativeContainerRender);
  assert.notEqual(SessionManager.prototype.buildContextEntries, nativeBuildContextEntries);
  assert.deepEqual([...shortcuts.keys()], ["alt+t"]);

  handlers.get("session_start")?.({}, {
    mode: "tui",
    ui: { setHiddenThinkingLabel() {} },
  });
  const sessionManager = SessionManager.inMemory();
  sessionManager.appendCustomMessageEntry("hidden", "secret", false);
  const renderedEntry = sessionManager.buildContextEntries()[0];
  assert.equal(renderedEntry?.type === "custom_message" && renderedEntry.display, true);
  const storedEntry = sessionManager.getEntries()[0];
  assert.equal(storedEntry?.type === "custom_message" && storedEntry.display, false);
  assert.deepEqual(handlers.get("message_end")?.({
    message: { role: "custom", customType: "hidden", content: "secret", display: false, timestamp: 1 },
  }, { mode: "tui" }), {
    message: { role: "custom", customType: "hidden", content: "secret", display: true, timestamp: 1 },
  });
  handlers.get("session_start")?.({}, {
    mode: "print",
    ui: {
      setHiddenThinkingLabel() {},
    },
  });
  assert.equal(handlers.get("message_end")?.({
    message: { role: "custom", customType: "hidden", content: "secret", display: false, timestamp: 1 },
  }, { mode: "print" }), undefined);
  const printEntry = sessionManager.buildContextEntries()[0];
  assert.equal(printEntry?.type === "custom_message" && printEntry.display, false);
  handlers.get("session_start")?.({}, {
    mode: "tui",
    ui: {
      setHiddenThinkingLabel() {},
    },
  });
  const tuiEntry = sessionManager.buildContextEntries()[0];
  assert.equal(tuiEntry?.type === "custom_message" && tuiEntry.display, true);

  let hiddenThinkingLabel = "Thinking...";
  handlers.get("session_start")?.({}, {
    mode: "tui",
    ui: {
      setHiddenThinkingLabel: (label: string) => { hiddenThinkingLabel = label; },
    },
  });
  assert.equal(hiddenThinkingLabel, "");

  const hiddenThinking = new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "hidden" }, { type: "toolCall" }],
    stopReason: "toolUse",
  } as unknown as ConstructorParameters<typeof AssistantMessageComponent>[0], false, undefined, "");
  assert.deepEqual(hiddenThinking.render(80), []);

  const noThinkingAnswer = new AssistantMessageComponent({
    content: [{ type: "text", text: "answer" }],
    stopReason: "stop",
  } as unknown as ConstructorParameters<typeof AssistantMessageComponent>[0], false, undefined, "");
  const nativeNoThinkingLines = nativeAssistantRender.call(noThinkingAnswer, 80);
  assert.deepEqual(noThinkingAnswer.render(80), nativeNoThinkingLines);

  const visibleAnswer = new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "answer" }],
    stopReason: "stop",
  } as unknown as ConstructorParameters<typeof AssistantMessageComponent>[0], false, undefined, "");
  const visibleAnswerLines = visibleAnswer.render(80);
  assert.equal(visibleAnswerLines.length, 1);
  assert.match(visibleAnswerLines[0]!, /answer/);

  const answer = new Container();
  answer.addChild(visibleAnswer);
  const answerLines = answer.render(80);
  assert.equal(answerLines.length, 3);
  assert.equal(answerLines[1], "");
  assert.match(answerLines[2]!, /answer/);

  const trace = new Container();
  trace.addChild(hiddenThinking);
  const tool = Object.assign(Object.create(ToolExecutionComponent.prototype), {
    expanded: false,
    toolName: "tool",
    render: () => ["native tool output"],
  });
  trace.addChild(tool);
  trace.addChild(new Spacer(1));
  const tool2 = Object.assign(Object.create(ToolExecutionComponent.prototype), {
    expanded: false,
    toolName: "tool2",
    render: () => ["native tool2 output"],
  });
  trace.addChild(tool2);
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(CustomMessageComponent.prototype), {
    _expanded: false,
    message: { customType: "custom-name" },
    render: () => ["native custom output"],
  }));
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(BashExecutionComponent.prototype), {
    render: () => ["user bash output"],
  }));
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(BranchSummaryMessageComponent.prototype), {
    render: () => ["branch summary"],
  }));
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(CompactionSummaryMessageComponent.prototype), {
    render: () => ["compaction summary"],
  }));
  trace.addChild(new Spacer(1));
  trace.addChild(new Text("Compaction: 1k tokens billed", 1, 0));
  trace.addChild(new Spacer(1));
  const customEntry = { entry: { type: "custom" }, render: () => ["custom entry"], invalidate() {} };
  trace.addChild(customEntry);
  trace.addChild(new Spacer(1));
  trace.addChild({ render: () => ["next message"], invalidate() {} });
  const second = Object.assign(Object.create(ToolExecutionComponent.prototype), {
    expanded: false,
    toolName: "second",
    render: () => ["native second output"],
  });
  trace.addChild(second);

  const compact = [" › think tool tool2 custom-name", "", "next message", "", " › second"];
  assert.deepEqual(trace.render(80), compact);

  tool.expanded = true;
  tool2.expanded = true;
  second.expanded = true;
  assistantPrototype.setHideThinkingBlock.call(hiddenThinking, false);
  assert.deepEqual(trace.render(80), compact);
  assert.deepEqual(trace.render(80), compact);

  handlers.get("session_shutdown")?.();

  assert.equal(toolPrototype.render, nativeToolRender);
  assert.equal(customPrototype.render, nativeCustomRender);
  assert.equal(assistantPrototype.render, nativeAssistantRender);
  assert.equal(assistantPrototype.setHideThinkingBlock, nativeSetHideThinking);
  assert.equal(assistantPrototype.updateContent, nativeUpdateContent);
  assert.equal(Object.hasOwn(CustomMessageComponent.prototype, "render"), false);
  assert.equal(userPrototype.render, nativeUserRender);
  assert.equal(containerPrototype.render, nativeContainerRender);
  assert.equal(SessionManager.prototype.buildContextEntries, nativeBuildContextEntries);
});

test("duplicate initialization restores shared patches after both shutdowns", () => {
  initTheme();
  const toolPrototype = ToolExecutionComponent.prototype as unknown as { render: unknown };
  const containerPrototype = Container.prototype as unknown as { render: unknown };
  const nativeToolRender = toolPrototype.render;
  const nativeContainerRender = containerPrototype.render;
  const shutdowns: Array<() => void> = [];
  const pi = {
    on(name: string, handler: () => void) {
      if (name === "session_shutdown") shutdowns.push(handler);
    },
    registerCommand() {},
    registerShortcut() {},
  } as unknown as ExtensionAPI;

  tinyTools(pi);
  tinyTools(pi);

  assert.equal(shutdowns.length, 2);
  assert.notEqual(toolPrototype.render, nativeToolRender);
  assert.notEqual(containerPrototype.render, nativeContainerRender);

  shutdowns[0]!();
  assert.notEqual(toolPrototype.render, nativeToolRender);
  assert.notEqual(containerPrototype.render, nativeContainerRender);

  shutdowns[1]!();
  assert.equal(toolPrototype.render, nativeToolRender);
  assert.equal(containerPrototype.render, nativeContainerRender);
});
