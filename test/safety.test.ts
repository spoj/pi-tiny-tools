import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  initTheme,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer } from "@earendil-works/pi-tui";
import tinyTools from "../src/index.ts";

test("thinking visibility selects compact or native tools without changing expansion", () => {
  initTheme();
  const toolPrototype = ToolExecutionComponent.prototype as unknown as { render: unknown };
  const customPrototype = CustomMessageComponent.prototype as unknown as { render: unknown };
  const assistantPrototype = AssistantMessageComponent.prototype as unknown as {
    render: (this: unknown, width: number) => string[];
    setHideThinkingBlock: (this: unknown, hide: boolean) => void;
  };
  const userPrototype = UserMessageComponent.prototype as unknown as { render: unknown };
  const containerPrototype = Container.prototype as unknown as { render: unknown };
  const nativeToolRender = toolPrototype.render;
  const nativeCustomRender = customPrototype.render;
  const nativeAssistantRender = assistantPrototype.render;
  const nativeSetHideThinking = assistantPrototype.setHideThinkingBlock;
  const nativeUserRender = userPrototype.render;
  const nativeContainerRender = containerPrototype.render;
  const handlers = new Map<string, (event?: unknown, ctx?: unknown) => void>();
  const pi = {
    on(name: string, handler: (event?: unknown, ctx?: unknown) => void) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;

  tinyTools(pi);

  assert.notEqual(toolPrototype.render, nativeToolRender);
  assert.notEqual(customPrototype.render, nativeCustomRender);
  assert.notEqual(assistantPrototype.render, nativeAssistantRender);
  assert.notEqual(assistantPrototype.setHideThinkingBlock, nativeSetHideThinking);
  assert.equal(userPrototype.render, nativeUserRender);
  assert.notEqual(containerPrototype.render, nativeContainerRender);

  let hiddenThinkingLabel = "Thinking...";
  handlers.get("session_start")?.({}, {
    ui: {
      setHiddenThinkingLabel: (label: string) => { hiddenThinkingLabel = label; },
    },
  });
  assert.equal(hiddenThinkingLabel, "");

  const hiddenThinking = new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "hidden" }, { type: "toolCall" }],
    stopReason: "toolUse",
  } as unknown as ConstructorParameters<typeof AssistantMessageComponent>[0], true, undefined, "");
  assert.deepEqual(hiddenThinking.render(80), []);

  const trace = new Container();
  trace.addChild({ render: () => ["assistant", " "], invalidate() {} });
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
    render: () => ["  › custom"],
  }));
  trace.addChild({ render: () => ["", "next message"], invalidate() {} });
  const second = Object.assign(Object.create(ToolExecutionComponent.prototype), {
    expanded: false,
    toolName: "second",
    render: () => ["native second output"],
  });
  trace.addChild(second);
  assert.deepEqual(trace.render(80), [
    "assistant", " ", "", "  › tool tool2", "  › custom", "", "next message", "", "  › second",
  ]);

  tool.expanded = true;
  tool2.expanded = true;
  second.expanded = true;
  assert.deepEqual(trace.render(80), [
    "assistant", " ", "", "  › tool tool2", "  › custom", "", "next message", "", "  › second",
  ]);

  assistantPrototype.setHideThinkingBlock.call({}, false);
  assert.equal(tool.expanded, true);
  assert.equal(tool2.expanded, true);
  assert.equal(second.expanded, true);
  assert.ok(trace.render(80).includes("native tool output"));
  assistantPrototype.setHideThinkingBlock.call({}, true);
  assert.deepEqual(trace.render(80), [
    "assistant", " ", "", "  › tool tool2", "  › custom", "", "next message", "", "  › second",
  ]);

  handlers.get("session_shutdown")?.();

  assert.equal(toolPrototype.render, nativeToolRender);
  assert.equal(customPrototype.render, nativeCustomRender);
  assert.equal(assistantPrototype.render, nativeAssistantRender);
  assert.equal(assistantPrototype.setHideThinkingBlock, nativeSetHideThinking);
  assert.equal(Object.hasOwn(CustomMessageComponent.prototype, "render"), false);
  assert.equal(userPrototype.render, nativeUserRender);
  assert.equal(containerPrototype.render, nativeContainerRender);
});
