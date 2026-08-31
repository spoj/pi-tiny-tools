import assert from "node:assert/strict";
import test from "node:test";
import { CustomMessageComponent, ToolExecutionComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";

test("targets tool and custom-message prototypes, never user messages", () => {
  assert.notEqual(ToolExecutionComponent.prototype, UserMessageComponent.prototype);
  assert.notEqual(CustomMessageComponent.prototype, UserMessageComponent.prototype);
  assert.equal(Object.hasOwn(UserMessageComponent.prototype, "__piTinyToolsPatch"), false);
});
