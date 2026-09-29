import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  initTheme,
  InteractiveMode,
  SessionManager,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion, Spacer, Text, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "../src/format.ts";
import tinyTools from "../src/index.ts";

type Message = ConstructorParameters<typeof AssistantMessageComponent>[0];

const NOTICES = ["addCacheMissNotice", "addCacheWarmingUsage", "addCompactionCostNotice"] as const;

function click(y: number): TuiMouseEvent {
  return { type: "click", button: "left", x: 3, y, screenX: 3, screenY: y, width: 60, height: 10, shift: false, alt: false, ctrl: false };
}

test("internal traces stay compact while native expansion state changes", () => {
  initTheme();
  const toolPrototype = ToolExecutionComponent.prototype as unknown as { render: unknown };
  const bashPrototype = BashExecutionComponent.prototype as unknown as Record<string, unknown>;
  const assistantPrototype = AssistantMessageComponent.prototype as unknown as {
    render: (this: unknown, width: number) => string[];
    setHideThinkingBlock: (this: unknown, hide: boolean) => void;
    updateContent: (this: unknown, message: unknown, isStreaming?: boolean) => void;
  };
  const userPrototype = UserMessageComponent.prototype as unknown as { render: unknown };
  const containerPrototype = Container.prototype as unknown as { render: unknown; handleMouse: unknown };
  const interactivePrototype = InteractiveMode.prototype as unknown as Record<(typeof NOTICES)[number], (this: unknown) => void> & {
    addMessageToChat(this: unknown, message: unknown, options?: unknown): void;
    renderSessionEntries(this: unknown, entries: unknown[], options?: unknown): void;
    renderSessionItems(this: unknown, items: unknown[], options?: unknown): void;
  };
  const native = {
    toolRender: toolPrototype.render,
    bash: ["appendOutput", "setComplete", "setExpanded", "invalidate"].map((key) => bashPrototype[key]),
    assistantRender: assistantPrototype.render,
    setHideThinking: assistantPrototype.setHideThinkingBlock,
    updateContent: assistantPrototype.updateContent,
    userRender: userPrototype.render,
    containerRender: containerPrototype.render,
    containerMouse: containerPrototype.handleMouse,
    addMessageToChat: interactivePrototype.addMessageToChat,
    notices: NOTICES.map((key) => interactivePrototype[key]),
  };
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

  assert.equal(toolPrototype.render, native.toolRender);
  assert.ok(["appendOutput", "setComplete", "setExpanded", "invalidate"].every((key, index) => bashPrototype[key] !== native.bash[index]));
  assert.equal(Object.hasOwn(CustomMessageComponent.prototype, "render"), false);
  assert.notEqual(assistantPrototype.render, native.assistantRender);
  assert.equal(assistantPrototype.setHideThinkingBlock, native.setHideThinking);
  assert.notEqual(assistantPrototype.updateContent, native.updateContent);
  assert.equal(userPrototype.render, native.userRender);
  assert.notEqual(containerPrototype.render, native.containerRender);
  assert.notEqual(containerPrototype.handleMouse, native.containerMouse);
  assert.notEqual(interactivePrototype.addMessageToChat, native.addMessageToChat);
  assert.deepEqual([...shortcuts.keys()], ["alt+t"]);

  handlers.get("session_start")?.({}, {
    mode: "tui",
    ui: { setHiddenThinkingLabel() {} },
  });
  const sessionManager = SessionManager.inMemory();
  sessionManager.appendCustomMessageEntry("hidden", "secret", false);
  const contextEntry = sessionManager.buildContextEntries()[0];
  assert.equal(contextEntry?.type === "custom_message" && contextEntry.display, false);
  const storedEntry = sessionManager.getEntries()[0];
  assert.equal(storedEntry?.type === "custom_message" && storedEntry.display, false);

  const hiddenMessage = { role: "custom", customType: "hidden", content: "secret", display: false, timestamp: 1 };
  const added: unknown[] = [];
  const interactive = {
    addMessageToChat: interactivePrototype.addMessageToChat,
    chatContainer: { addChild: (child: unknown) => { added.push(child); } },
    getMarkdownThemeWithSettings: () => undefined,
    outputPad: 0,
    session: { extensionRunner: { getMessageRenderer: () => undefined } },
    toolOutputExpanded: false,
  };
  interactive.addMessageToChat(hiddenMessage, undefined);
  assert.equal(added.length, 1);
  assert.ok(added[0] instanceof CustomMessageComponent);
  assert.equal(hiddenMessage.display, false);
  interactive.addMessageToChat({ ...hiddenMessage, display: true }, undefined);
  assert.equal(added.length, 2);

  const resumed: unknown[] = [];
  const resumedInteractive = {
    addMessageToChat: interactivePrototype.addMessageToChat,
    renderSessionEntries: interactivePrototype.renderSessionEntries,
    renderSessionItems: interactivePrototype.renderSessionItems,
    chatContainer: { addChild: (child: unknown) => { resumed.push(child); } },
    getMarkdownThemeWithSettings: () => undefined,
    outputPad: 0,
    pendingTools: new Map(),
    session: { extensionRunner: { getMessageRenderer: () => undefined } },
    sessionManager,
    settingsManager: { getShowCacheMissNotices: () => false },
    toolOutputExpanded: false,
    ui: { requestRender() {} },
  };
  resumedInteractive.renderSessionEntries(sessionManager.buildContextEntries());
  assert.equal(resumed.length, 1);
  assert.ok(resumed[0] instanceof CustomMessageComponent);

  const notices = { chatContainer: new Container() };
  for (const key of NOTICES) interactivePrototype[key].call(notices);
  assert.equal(notices.chatContainer.children.length, 0);

  let hiddenThinkingLabel = "Thinking...";
  const colors: Array<[string, string]> = [];
  const bashUi = { requestRender() {} } as ConstructorParameters<typeof BashExecutionComponent>[1];
  const shells = [new BashExecutionComponent("pwd", bashUi, true), new BashExecutionComponent("pwd", bashUi, true), new BashExecutionComponent("pwd", bashUi)];
  const dimHeader = (shells[0] as unknown as { contentContainer: { children: Array<{ text: string }> } }).contentContainer.children[0]!.text;
  handlers.get("session_start")?.({}, {
    mode: "tui",
    ui: {
      theme: {
        bold: (text: string) => text,
        fg: (color: string, text: string) => {
          colors.push([color, text]);
          return color === "dim" && text === "$ pwd" ? dimHeader : text;
        },
      },
      setHiddenThinkingLabel: (label: string) => { hiddenThinkingLabel = label; },
    },
  });
  assert.equal(hiddenThinkingLabel, "");

  shells[0]!.setExpanded(true);
  shells[1]!.appendOutput("/tmp");
  shells[1]!.invalidate();
  for (const shell of shells) shell.setComplete(0, false);
  assert.deepEqual(shells.map((shell) => {
    const container = new Container();
    container.addChild(shell);
    return container.render(80);
  }), [[" › !!"], [" › !!"], [" › !"]]);

  const hiddenThinking = new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "hidden" }, { type: "toolCall" }],
    stopReason: "toolUse",
  } as unknown as Message, false, undefined, "");
  assert.deepEqual(hiddenThinking.render(80), []);

  const noThinkingAnswer = new AssistantMessageComponent({
    content: [{ type: "text", text: "answer" }],
    stopReason: "stop",
  } as unknown as Message, false, undefined, "");
  assert.deepEqual(noThinkingAnswer.render(80), native.assistantRender.call(noThinkingAnswer, 80));

  const visibleAnswer = new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "answer" }],
    stopReason: "stop",
  } as unknown as Message, false, undefined, "");
  const visibleAnswerLines = visibleAnswer.render(80);
  assert.equal(visibleAnswerLines.length, 2);
  assert.equal(stripTerminalSequences(visibleAnswerLines[0]!), "");
  assert.ok(visibleAnswerLines[0]!.startsWith("\x1b]133;A\x07"));
  assert.match(visibleAnswerLines[1]!, /answer/);

  const answer = new Container();
  answer.addChild(visibleAnswer);
  const answerLines = answer.render(80).map(stripTerminalSequences);
  assert.deepEqual(answerLines.map((line) => line.trim()), ["› think", "", "answer"]);

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
  trace.addChild(Object.assign(Object.create(ToolExecutionComponent.prototype), {
    hideComponent: true,
    toolName: "hidden-tool",
  }));
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(CustomMessageComponent.prototype), {
    _expanded: false,
    message: { customType: "custom-name" },
    render: () => ["native custom output"],
  }));
  trace.addChild(new Spacer(1));
  trace.addChild(shells[2]!);
  trace.addChild(new Spacer(1));
  trace.addChild(shells[0]!);
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(BranchSummaryMessageComponent.prototype), {
    render: () => ["branch summary"],
  }));
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(CompactionSummaryMessageComponent.prototype), {
    render: () => ["compaction summary"],
  }));
  trace.addChild(new Spacer(1));
  const customEntry = { entry: { type: "custom", customType: "state" }, render: () => ["custom entry"], invalidate() {} };
  trace.addChild(customEntry);
  trace.addChild(new Spacer(1));
  trace.addChild(Object.assign(Object.create(SkillInvocationMessageComponent.prototype), {
    skillBlock: { name: "review" },
    render: () => ["full skill"],
  }));
  trace.addChild(new Spacer(1));
  trace.addChild({ render: () => ["next message"], invalidate() {} });
  const second = Object.assign(Object.create(ToolExecutionComponent.prototype), {
    expanded: false,
    toolName: "second",
    render: () => ["native second output"],
  });
  trace.addChild(second);

  const compact = [" › think tool tool2 custom-name ! !! branch summary compaction state review", "", "next message", "", " › second"];
  assert.deepEqual(trace.render(80), compact);
  assert.ok(colors.some(([color, text]) => color === "accent" && text === "tool"));
  for (const [result, isPartial, expectedColor] of [
    [{ isError: false }, false, "success"],
    [{ isError: false }, true, "accent"],
    [{ isError: true }, true, "error"],
  ] as const) {
    Object.assign(tool, { result, isPartial });
    colors.length = 0;
    assert.deepEqual(trace.render(80), compact);
    assert.ok(colors.some(([color, text]) => color === expectedColor && text === "tool"));
  }

  tool.expanded = true;
  tool2.expanded = true;
  second.expanded = true;
  assistantPrototype.setHideThinkingBlock.call(hiddenThinking, false);
  assert.deepEqual(trace.render(80), compact);
  assert.deepEqual(trace.render(80), compact);

  const reply = new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "secret plan" }, { type: "text", text: "line one\n\nline two" }],
    stopReason: "stop",
  } as unknown as Message, true, undefined, "");
  const replyContainer = new Container();
  replyContainer.addChild(reply);
  const replyLines = replyContainer.render(60);
  for (let y = 0; y < replyLines.length; y++) assert.equal(replyContainer.handleMouse(click(y)), undefined);
  assert.deepEqual(replyContainer.render(60), replyLines);
  assert.doesNotMatch(replyLines.join("\n"), /secret plan/);

  const plain = new Container();
  plain.addChild(new MouseRegion(new Text("x", 0, 0), () => ({ handled: true })));
  plain.render(60);
  assert.ok(plain.handleMouse(click(0)));

  handlers.get("session_shutdown")?.();

  assert.equal(toolPrototype.render, native.toolRender);
  assert.deepEqual(["appendOutput", "setComplete", "setExpanded", "invalidate"].map((key) => bashPrototype[key]), native.bash);
  assert.equal(assistantPrototype.render, native.assistantRender);
  assert.equal(assistantPrototype.setHideThinkingBlock, native.setHideThinking);
  assert.equal(assistantPrototype.updateContent, native.updateContent);
  assert.equal(Object.hasOwn(CustomMessageComponent.prototype, "render"), false);
  assert.equal(userPrototype.render, native.userRender);
  assert.equal(containerPrototype.render, native.containerRender);
  assert.equal(containerPrototype.handleMouse, native.containerMouse);
  assert.equal(interactivePrototype.addMessageToChat, native.addMessageToChat);
  assert.deepEqual(NOTICES.map((key) => interactivePrototype[key]), native.notices);
});

test("duplicate initialization restores shared patches after both shutdowns", () => {
  initTheme();
  const containerPrototype = Container.prototype as unknown as { render: unknown };
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
  assert.notEqual(containerPrototype.render, nativeContainerRender);

  shutdowns[0]!();
  assert.notEqual(containerPrototype.render, nativeContainerRender);

  shutdowns[1]!();
  assert.equal(containerPrototype.render, nativeContainerRender);
});
