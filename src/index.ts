import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type ExtensionAPI,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, type Component } from "@earendil-works/pi-tui";
import { messageText, renderTraceGroup, stripTerminalSequences, type TraceRow } from "./format.ts";
import { showTraceInspector, type TraceItem } from "./trace-inspector.ts";

// Keep the theme, not the ctx: Pi's theme follows theme switches, while a ctx goes stale when its session ends.
let currentTheme: Theme | undefined;

type Interactive = {
  chatContainer: Container;
  sessionManager: { getBranch(): SessionEntry[] };
  rebuildChatFromMessages(): void;
};
// Pi's interactive mode outlives this module: /reload imports a fresh copy after Pi has redrawn the transcript.
const shared = ((globalThis as { [key: symbol]: unknown })[Symbol.for("pi-tiny-tools")] ??= {}) as { interactive?: Interactive };

function patchMethod<T extends object, K extends keyof T>(
  target: T,
  key: K,
  wrap: (original: T[K]) => T[K],
): () => void {
  const original = target[key];
  const hadOwn = Object.hasOwn(target, key);
  const replacement = wrap(original);
  target[key] = replacement;
  return () => {
    if (target[key] !== replacement) return;
    if (hadOwn) target[key] = original;
    else Reflect.deleteProperty(target, key);
  };
}

function isBlank(line: string): boolean {
  return stripTerminalSequences(line).trim() === "";
}

function named(name: unknown, fallback: string): string {
  return typeof name === "string" && name ? name : fallback;
}

function traceRow(component: unknown): TraceRow | undefined {
  if (component instanceof ToolExecutionComponent) {
    const tool = component as unknown as { hideComponent?: unknown; toolName?: unknown; result?: { isError?: unknown }; isPartial?: unknown };
    if (tool.hideComponent === true) return undefined;
    return {
      name: named(tool.toolName, "tool"),
      color: tool.result?.isError ? "error" : tool.result && tool.isPartial !== true ? "success" : "accent",
    };
  }
  if (component instanceof AssistantMessageComponent) {
    return messageText(component, "thinking") ? { name: "think", color: "thinkingText" } : undefined;
  }
  if (component instanceof BashExecutionComponent) {
    // Pi keeps no excludeFromContext flag, but `!!` commands draw their borders dim.
    const border = component.children[1] as unknown as { color: (text: string) => string };
    const status = (component as unknown as { status: string }).status;
    return {
      name: currentTheme && border.color("─") === currentTheme.fg("dim", "─") ? "!!" : "!",
      color: status === "running" ? "accent" : status === "complete" ? "success" : "error",
    };
  }
  if (component instanceof CustomMessageComponent) {
    const message = (component as unknown as { message?: { customType?: unknown } }).message;
    return { name: named(message?.customType, "extension"), color: "customMessageLabel" };
  }
  if (component instanceof BranchSummaryMessageComponent) return { name: "branch summary", color: "customMessageLabel" };
  if (component instanceof CompactionSummaryMessageComponent) return { name: "compaction", color: "customMessageLabel" };
  if (component instanceof SkillInvocationMessageComponent) {
    return { name: (component as unknown as { skillBlock: { name: string } }).skillBlock.name, color: "customMessageLabel" };
  }
  const entry = (component as { entry?: { type?: unknown; customType?: unknown } } | undefined)?.entry;
  return entry?.type === "custom" ? { name: named(entry.customType, "extension"), color: "customMessageLabel" } : undefined;
}

function isTraced(component: unknown): boolean {
  return traceRow(component) !== undefined;
}

// The inspector draws a message as its thinking and tells items apart by component, so a reply needs its own.
const replies = new WeakMap<AssistantMessageComponent, Component>();

function reply(message: AssistantMessageComponent): Component {
  let view = replies.get(message);
  if (!view) replies.set(message, (view = { render: (width) => message.render(width), invalidate() {} }));
  return view;
}

// Most of Pi's components drop their message, so each keeps the time of the message Pi drew it for.
const times = new WeakMap<Component, number>();

function traceItems(): TraceItem[] {
  let time: number | undefined;
  return (shared.interactive?.chatContainer.children ?? []).flatMap((component): TraceItem[] => {
    const message = (component as { lastMessage?: { model: string; timestamp: number } }).lastMessage;
    // Tool calls, and anything else drawn without a message, take the time of the message before them.
    time = times.get(component) ?? message?.timestamp ?? time;
    if (component instanceof UserMessageComponent) return [{ component, row: { name: "user", color: "text" }, time }];
    const row = traceRow(component);
    const items: TraceItem[] = row ? [{ component, row, time, model: message?.model }] : [];
    if (component instanceof AssistantMessageComponent && messageText(component, "text")) {
      items.push({ component: reply(component), row: { name: "assistant", color: "text" }, time, model: message?.model });
    }
    return items;
  });
}

function renderTraceGroups(children: Component[], width: number): string[] {
  const output: string[] = [];
  const rows: TraceRow[] = [];
  let spacing: string[] = [];

  const flushRows = (): void => {
    if (rows.length === 0) return;
    if (output.length > 0) output.push("");
    output.push(...renderTraceGroup(rows, width, currentTheme));
    rows.length = 0;
  };

  for (const child of children) {
    if (child instanceof Spacer) {
      spacing.push(...child.render(width));
      continue;
    }
    const row = traceRow(child);
    if (row) {
      rows.push(row);
      spacing = [];
      // A reply keeps its text; everything else shrinks to its row.
      if (!(child instanceof AssistantMessageComponent)) continue;
    }
    const lines = child.render(width);
    if (lines.length === 0) continue;
    flushRows();
    output.push(...spacing, ...lines);
    spacing = [];
  }

  flushRows();
  return [...output, ...spacing];
}

export default function tinyTools(pi: ExtensionAPI): void {
  pi.registerCommand("trace", {
    description: "Step through the transcript with minimized items expanded",
    handler: async (_args, ctx) => showTraceInspector(ctx, traceItems),
  });
  pi.registerShortcut("alt+t", {
    description: "Toggle the trace inspector",
    handler: (ctx) => showTraceInspector(ctx, traceItems),
  });

  let restorePatches: (() => void)[] = [];

  // Workflow subagents load this extension in the same process; only the TUI session may patch or theme.
  pi.on("session_start", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentTheme = ctx.ui.theme;
    ctx.ui.setHiddenThinkingLabel("");
    const interactive = InteractiveMode.prototype as unknown as {
      addMessageToChat(this: { chatContainer: Container }, message: { role?: unknown; display?: unknown; timestamp: number }, options?: unknown): void;
      renderSessionEntries(this: Interactive, entries: SessionEntry[], options?: unknown): void;
      addCacheMissNotice(): void;
      addCacheWarmingUsage(): void;
      addCompactionCostNotice(): void;
    };
    const silence = () => () => {};
    restorePatches = [
      patchMethod(AssistantMessageComponent.prototype, "render", (original) => function (this: AssistantMessageComponent, width: number) {
        const lines = original.call(this, width);
        if (lines.every(isBlank)) return [];
        if (!messageText(this, "thinking")) return lines;
        // Drop the hidden thinking label but keep the leading spacer, which carries Pi's prompt marker.
        return [lines[0]!, ...lines.slice(lines.findIndex((line) => !isBlank(line)))];
      }),
      patchMethod(AssistantMessageComponent.prototype, "updateContent", (original) => function (
        this: AssistantMessageComponent,
        message: Parameters<AssistantMessageComponent["updateContent"]>[0],
        isStreaming?: boolean,
      ) {
        (this as unknown as { hideThinkingBlock: boolean }).hideThinkingBlock = true;
        original.call(this, message, isStreaming);
      }),
      patchMethod(Container.prototype, "render", (original) => function (this: Container, width: number) {
        return this.children.some(isTraced) ? renderTraceGroups(this.children, width) : original.call(this, width);
      }),
      // Pi routes clicks by each child's native height, and a click on a reply would reveal its thinking.
      patchMethod(Container.prototype, "handleMouse", (original) => function (this: Container, event) {
        return this.children.some(isTraced) ? undefined : original.call(this, event);
      }),
      patchMethod(interactive, "renderSessionEntries", (original) => function (entries, options): void {
        shared.interactive = this;
        const branch = this.sessionManager.getBranch();
        const compaction = branch.filter((entry) => entry.type === "compaction").at(-1);
        if (!compaction || entries.some((entry) => entry.id === compaction.id)) {
          original.call(this, branch, options);
        } else if (this.chatContainer.children.length === 0) {
          // After compacting, Pi clears the chat, renders what precedes the newest summary, then appends the summary.
          const index = branch.indexOf(compaction);
          const rendered = new Set(entries.map((entry) => entry.id));
          original.call(this, branch.filter((entry, i) => i < index || rendered.has(entry.id)), options);
        } else {
          // A turn-boundary compaction renders the entries chained after its summary separately.
          original.call(this, entries, options);
        }
      }),
      patchMethod(interactive, "addMessageToChat", (original) => function (this: { chatContainer: Container }, message, options): void {
        const added = this.chatContainer.children.length;
        original.call(this, message.role === "custom" ? { ...message, display: true } : message, options);
        for (const child of this.chatContainer.children.slice(added)) times.set(child, message.timestamp);
      }),
      patchMethod(interactive, "addCacheMissNotice", silence),
      patchMethod(interactive, "addCacheWarmingUsage", silence),
      patchMethod(interactive, "addCompactionCostNotice", silence),
    ];
    // On /reload Pi redraws the transcript before this runs, without these patches.
    if (event.reason === "reload") shared.interactive?.rebuildChatFromMessages();
  });

  pi.on("session_shutdown", () => {
    if (restorePatches.length === 0) return;
    for (const restore of restorePatches.reverse()) restore();
    restorePatches = [];
    currentTheme = undefined;
  });
}
