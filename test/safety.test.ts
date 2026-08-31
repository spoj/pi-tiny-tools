import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import tinyTools from "../src/index.ts";

test("patches tools and custom messages without touching user messages", () => {
  const toolPrototype = ToolExecutionComponent.prototype as unknown as { render: unknown };
  const customPrototype = CustomMessageComponent.prototype as unknown as { render: unknown };
  const userPrototype = UserMessageComponent.prototype as unknown as { render: unknown };
  const nativeToolRender = toolPrototype.render;
  const nativeCustomRender = customPrototype.render;
  const nativeUserRender = userPrototype.render;
  const handlers = new Map<string, () => void>();
  const pi = {
    on(name: string, handler: () => void) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;

  tinyTools(pi);

  assert.notEqual(toolPrototype.render, nativeToolRender);
  assert.notEqual(customPrototype.render, nativeCustomRender);
  assert.equal(userPrototype.render, nativeUserRender);

  handlers.get("session_shutdown")?.();

  assert.equal(toolPrototype.render, nativeToolRender);
  assert.equal(customPrototype.render, nativeCustomRender);
  assert.equal(Object.hasOwn(CustomMessageComponent.prototype, "render"), false);
  assert.equal(userPrototype.render, nativeUserRender);
});
