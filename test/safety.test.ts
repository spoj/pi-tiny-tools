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
import { Container } from "@earendil-works/pi-tui";
import tinyTools from "../src/index.ts";

test("patches compact rows, groups traces, and syncs tool expansion with thinking", () => {
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

  let toolsExpanded = false;
  let hiddenThinkingLabel = "Thinking...";
  handlers.get("session_start")?.({}, {
    ui: {
      setToolsExpanded: (expanded: boolean) => { toolsExpanded = expanded; },
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
  trace.addChild(Object.assign(Object.create(ToolExecutionComponent.prototype), {
    expanded: false,
    render: () => ["  › tool"],
  }));
  trace.addChild({ render: () => [""], invalidate() {} });
  trace.addChild(Object.assign(Object.create(CustomMessageComponent.prototype), {
    _expanded: false,
    render: () => ["  › custom"],
  }));
  trace.addChild({ render: () => ["", "next message"], invalidate() {} });
  trace.addChild(Object.assign(Object.create(ToolExecutionComponent.prototype), {
    expanded: false,
    render: () => ["  › second tool"],
  }));
  assert.deepEqual(trace.render(80), [
    "assistant", " ", "", "  › tool", "  › custom", "", "next message", "", "  › second tool",
  ]);

  assistantPrototype.setHideThinkingBlock.call({}, false);
  assert.equal(toolsExpanded, true);
  assistantPrototype.setHideThinkingBlock.call({}, true);
  assert.equal(toolsExpanded, false);

  handlers.get("session_shutdown")?.();

  assert.equal(toolPrototype.render, nativeToolRender);
  assert.equal(customPrototype.render, nativeCustomRender);
  assert.equal(assistantPrototype.render, nativeAssistantRender);
  assert.equal(assistantPrototype.setHideThinkingBlock, nativeSetHideThinking);
  assert.equal(Object.hasOwn(CustomMessageComponent.prototype, "render"), false);
  assert.equal(userPrototype.render, nativeUserRender);
  assert.equal(containerPrototype.render, nativeContainerRender);
});
