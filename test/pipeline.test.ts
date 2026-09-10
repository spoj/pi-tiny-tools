import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("hidden custom messages stay hidden through the real agent session pipeline", async (t) => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  const agentDir = mkdtempSync(join(tmpdir(), "tiny-tools-agent-"));
  const cwd = join(agentDir, "work");
  mkdirSync(cwd);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    rmSync(agentDir, { recursive: true, force: true });
  });

  const { createAgentSessionFromServices, createAgentSessionServices, InteractiveMode, SessionManager } =
    await import("@earendil-works/pi-coding-agent");
  const { default: tinyTools } = await import("../src/index.ts");
  const interactivePrototype = InteractiveMode.prototype as unknown as { addMessageToChat: unknown };
  const nativeAddMessageToChat = interactivePrototype.addMessageToChat;

  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: { extensionFactories: [tinyTools] },
  });
  assert.notEqual(interactivePrototype.addMessageToChat, nativeAddMessageToChat);

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  await session.bindExtensions({ mode: "tui" });
  t.after(async () => {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    assert.equal(interactivePrototype.addMessageToChat, nativeAddMessageToChat);
  });

  const message = { role: "custom", customType: "hidden-probe", content: "secret", display: false, timestamp: 123 };
  const handleAgentEvent = (session as unknown as { _handleAgentEvent(event: unknown): Promise<void> })._handleAgentEvent.bind(session);
  await handleAgentEvent({ type: "message_start", message });
  await handleAgentEvent({ type: "message_end", message });

  const stored = session.sessionManager.getEntries().find((entry) => entry.type === "custom_message");
  assert.equal(stored?.type === "custom_message" && stored.display, false);
  assert.equal(message.display, false);
});
