import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  initTheme,
  InteractiveMode,
  UserMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import tinyTools from "../src/index.ts";
import { TraceInspector, type TraceItem } from "../src/trace-inspector.ts";

initTheme();
const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;

function fakeTui(rows: number): TUI & { renders: number } {
  const tui = { terminal: { rows }, renders: 0, requestRender() { tui.renders++; } };
  return tui as unknown as TUI & { renders: number };
}

function tool(name: string, lines: string[]): TraceItem & { component: Component & { lines: string[]; expanded: boolean } } {
  const component = {
    lines,
    expanded: false,
    setExpanded(expanded: boolean) { component.expanded = expanded; },
    render: () => component.lines,
    invalidate() {},
  };
  return { component, row: { name, color: "success" } };
}

const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${index}`);

test("inspector shows the newest item expanded, full screen, within its width", () => {
  const items = [tool("read", ["read one.ts"]), tool("bash", numbered(3))];
  const inspector = new TraceInspector(() => items, theme, fakeTui(8), () => {});

  const lines = inspector.render(40);
  assert.equal(lines.length, 8);
  assert.ok(lines.every((line) => visibleWidth(line) === 40));
  assert.match(lines[0]!, /^─ trace 2\/2 · bash ─+$/);
  assert.deepEqual(lines.slice(1, 4).map((line) => line.trimEnd()), ["line 0", "line 1", "line 2"]);
  assert.match(lines[7]!, /^─ j\/k item · PgUp\/PgDn scroll · g\/G top\//);
  assert.match(inspector.render(80)[7]!, /^─ j\/k item · PgUp\/PgDn scroll · g\/G top\/bottom · Esc close ─+$/);
  assert.equal(items[1]!.component.expanded, true);
  assert.equal(items[0]!.component.expanded, false);
});

test("inspector navigates items and scrolls long content", () => {
  const tui = fakeTui(6);
  const items = [tool("read", numbered(10)), tool("bash", ["done"])];
  const inspector = new TraceInspector(() => items, theme, tui, () => {});
  inspector.render(40);

  inspector.handleInput("k");
  let lines = inspector.render(40);
  assert.match(lines[0]!, /trace 1\/2 · read .* 1–4 of 10 ─$/);
  assert.equal(items[0]!.component.expanded, true);

  inspector.handleInput("\x1b[6~");
  assert.match(inspector.render(40)[1]!, /^line 4/);
  inspector.handleInput("G");
  lines = inspector.render(40);
  assert.match(lines[0]!, /7–10 of 10/);
  assert.match(lines[4]!, /^line 9/);
  inspector.handleMouse({ type: "wheel", wheelDelta: -2 } as never);
  assert.match(inspector.render(40)[1]!, /^line 4/);
  inspector.handleInput("g");
  assert.match(inspector.render(40)[1]!, /^line 0/);

  inspector.handleInput("k");
  assert.match(inspector.render(40)[0]!, /trace 1\/2/);
  inspector.handleInput("j");
  assert.match(inspector.render(40)[0]!, /trace 2\/2 · bash/);
  assert.equal(tui.renders, 6);
});

test("inspector follows new items and tails growing output", () => {
  const items = [tool("bash", ["one"])];
  const inspector = new TraceInspector(() => items, theme, fakeTui(5), () => {});
  inspector.render(40);

  items.push(tool("bash", ["start"]));
  assert.match(inspector.render(40)[0]!, /trace 2\/2/);
  items[1]!.component.lines = numbered(8);
  let lines = inspector.render(40);
  assert.match(lines[0]!, /6–8 of 8/);
  assert.match(lines[3]!, /^line 7/);

  inspector.handleInput("\x1b[5~");
  items[1]!.component.lines = numbered(12);
  assert.match(inspector.render(40)[0]!, /3–5 of 12/);

  inspector.handleInput("k");
  items.push(tool("read", ["new"]));
  assert.match(inspector.render(40)[0]!, /trace 1\/3/);
});

test("inspector renders thinking in Pi's thinking style and updates it live", () => {
  const colors: string[] = [];
  const thinkingTheme = { fg: (color: string, text: string) => { colors.push(color); return text; } } as unknown as Theme;
  const message = { content: [{ type: "thinking", thinking: "first idea" }] };
  const reply = { lastMessage: message, render: () => ["the answer"], invalidate() {} };
  const inspector = new TraceInspector(() => [{ component: reply, row: { name: "think", color: "thinkingText" } }], thinkingTheme, fakeTui(6), () => {});

  let text = inspector.render(40).join("\n");
  assert.match(text, /first idea/);
  assert.doesNotMatch(text, /the answer/);
  assert.ok(colors.includes("thinkingText"));

  message.content.push({ type: "thinking", thinking: "second idea" });
  text = inspector.render(40).join("\n");
  assert.match(text, /first idea/);
  assert.match(text, /second idea/);
});

test("inspector closes on Escape, Ctrl+C, and Alt+T", () => {
  for (const key of ["\x1b", "\x03", "\x1bt"]) {
    let closed = false;
    new TraceInspector(() => [tool("bash", [])], theme, fakeTui(5), () => { closed = true; }).handleInput(key);
    assert.equal(closed, true);
  }
});

test("/trace steps through the rendered transcript, including your messages and replies", async () => {
  const commands = new Map<string, (args: string, ctx: ExtensionContext) => Promise<void>>();
  let shutdown!: () => void;
  tinyTools({
    on(name: string, handler: (event?: unknown, ctx?: unknown) => void) {
      if (name === "session_start") handler({}, { mode: "tui", ui: { setHiddenThinkingLabel() {} } });
      if (name === "session_shutdown") shutdown = handler;
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) {
      commands.set(name, options.handler);
    },
    registerShortcut() {},
  } as unknown as ExtensionAPI);

  const notifications: string[] = [];
  let inspector: Component | undefined;
  const ctx = {
    mode: "tui",
    ui: {
      notify: (message: string) => notifications.push(message),
      async custom(factory: (tui: TUI, theme: Theme, keybindings: unknown, done: () => void) => Component) {
        inspector = factory(fakeTui(6), theme, undefined, () => {});
      },
    },
  } as unknown as ExtensionContext;

  await commands.get("trace")!("", ctx);
  assert.deepEqual(notifications, ["No traceable items in the current branch"]);

  const chatContainer = new Container();
  const interactive = InteractiveMode.prototype as unknown as { renderSessionEntries(this: unknown, entries: unknown[]): void };
  interactive.renderSessionEntries.call({ chatContainer, sessionManager: { getBranch: () => [] }, renderSessionItems() {} }, []);
  chatContainer.addChild(new UserMessageComponent("fix the bug"));
  chatContainer.addChild(new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "plan the fix" }, { type: "toolCall" }],
    stopReason: "toolUse",
  } as never, true, undefined, ""));
  chatContainer.addChild(new AssistantMessageComponent({
    content: [{ type: "thinking", thinking: "check it" }, { type: "text", text: "Fixed." }],
    stopReason: "stop",
  } as never, true, undefined, ""));

  await commands.get("trace")!("", ctx);
  const pages: string[] = [];
  for (let page = 0; page < 4; page++) {
    const lines = inspector!.render(40);
    assert.ok(lines.every((line) => visibleWidth(line) === 40));
    pages.push(lines.join("\n"));
    inspector!.handleInput!("k");
  }
  assert.match(pages[0]!, /trace 4\/4 · assistant[\s\S]*Fixed\./);
  assert.doesNotMatch(pages[0]!, /check it/);
  assert.match(pages[1]!, /trace 3\/4 · think[\s\S]*check it/);
  assert.doesNotMatch(pages[1]!, /Fixed/);
  assert.match(pages[2]!, /trace 2\/4 · think[\s\S]*plan the fix/);
  assert.match(pages[3]!, /trace 1\/4 · user[\s\S]*fix the bug/);

  shutdown();
});
