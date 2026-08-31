import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import tinyTools from "../src/index.ts";

test("patches compact rows and syncs tool expansion with thinking", () => {
  const toolPrototype = ToolExecutionComponent.prototype as unknown as { render: unknown };
  const customPrototype = CustomMessageComponent.prototype as unknown as { render: unknown };
  const assistantPrototype = AssistantMessageComponent.prototype as unknown as {
    setHideThinkingBlock: (this: unknown, hide: boolean) => void;
  };
  const userPrototype = UserMessageComponent.prototype as unknown as { render: unknown };
  const nativeToolRender = toolPrototype.render;
  const nativeCustomRender = customPrototype.render;
  const nativeSetHideThinking = assistantPrototype.setHideThinkingBlock;
  const nativeUserRender = userPrototype.render;
  const handlers = new Map<string, (event?: unknown, ctx?: unknown) => void>();
  const pi = {
    on(name: string, handler: (event?: unknown, ctx?: unknown) => void) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;

  tinyTools(pi);

  assert.notEqual(toolPrototype.render, nativeToolRender);
  assert.notEqual(customPrototype.render, nativeCustomRender);
  assert.notEqual(assistantPrototype.setHideThinkingBlock, nativeSetHideThinking);
  assert.equal(userPrototype.render, nativeUserRender);

  let toolsExpanded = false;
  handlers.get("session_start")?.({}, {
    ui: {
      setToolsExpanded: (expanded: boolean) => { toolsExpanded = expanded; },
    },
  });
  assistantPrototype.setHideThinkingBlock.call({}, false);
  assert.equal(toolsExpanded, true);
  assistantPrototype.setHideThinkingBlock.call({}, true);
  assert.equal(toolsExpanded, false);

  handlers.get("session_shutdown")?.();

  assert.equal(toolPrototype.render, nativeToolRender);
  assert.equal(customPrototype.render, nativeCustomRender);
  assert.equal(assistantPrototype.setHideThinkingBlock, nativeSetHideThinking);
  assert.equal(Object.hasOwn(CustomMessageComponent.prototype, "render"), false);
  assert.equal(userPrototype.render, nativeUserRender);
});
