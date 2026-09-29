import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  type ExtensionAPI,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, type Component } from "@earendil-works/pi-tui";
import { renderTraceGroup, stripTerminalSequences, thinkingText, type TraceRow } from "./format.ts";
import {
  finishLiveAssistant,
  finishLiveTool,
  forgetLiveTool,
  pruneLiveItems,
  resetLiveItems,
  showTraceInspector,
  startLiveTool,
  updateLiveAssistant,
  updateLiveTool,
} from "./trace-inspector.ts";

let currentTheme: (() => Theme | undefined) | undefined;
let patchUsers = 0;
let restorePatches: (() => void)[] | undefined;

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
    return thinkingText(component) ? { name: "think", color: "thinkingText" } : undefined;
  }
  if (component instanceof BashExecutionComponent) {
    // Pi keeps no excludeFromContext flag, but `!!` commands draw their borders dim.
    const border = component.children[1] as unknown as { color: (text: string) => string };
    const theme = currentTheme?.();
    const status = (component as unknown as { status: string }).status;
    return {
      name: theme && border.color("─") === theme.fg("dim", "─") ? "!!" : "!",
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

function renderTraceGroups(children: Component[], width: number): string[] {
  const output: string[] = [];
  const rows: TraceRow[] = [];
  let spacing: string[] = [];

  const flushRows = (): void => {
    if (rows.length === 0) return;
    if (output.length > 0) output.push("");
    output.push(...renderTraceGroup(rows, width, currentTheme?.()));
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
    description: "Inspect minimized transcript items",
    handler: async (_args, ctx) => showTraceInspector(ctx),
  });
  pi.registerShortcut("alt+t", {
    description: "Toggle the internal trace inspector",
    handler: showTraceInspector,
  });

  if (patchUsers === 0) {
    const interactive = InteractiveMode.prototype as unknown as {
      addMessageToChat(this: unknown, message: { role?: unknown; display?: unknown }, options?: unknown): void;
      renderSessionEntries(this: { sessionManager: { getBranch(): SessionEntry[] } }, entries: SessionEntry[], options?: unknown): void;
      addCacheMissNotice(): void;
      addCacheWarmingUsage(): void;
      addCompactionCostNotice(): void;
    };
    const silence = () => () => {};
    restorePatches = [
      patchMethod(AssistantMessageComponent.prototype, "render", (original) => function (this: AssistantMessageComponent, width: number) {
        const lines = original.call(this, width);
        if (lines.every(isBlank)) return [];
        if (!thinkingText(this)) return lines;
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
        const branch = this.sessionManager.getBranch();
        const latestCompaction = branch.filter((entry) => entry.type === "compaction").at(-1);
        // Pi appends the newest summary separately when compaction finishes.
        const appendSummary = latestCompaction && !entries.some((entry) => entry.id === latestCompaction.id);
        original.call(this, branch.filter((entry) => !appendSummary || entry !== latestCompaction), options);
      }),
      patchMethod(interactive, "addMessageToChat", (original) => function (this: unknown, message, options): void {
        original.call(this, message.role === "custom" ? { ...message, display: true } : message, options);
      }),
      patchMethod(interactive, "addCacheMissNotice", silence),
      patchMethod(interactive, "addCacheWarmingUsage", silence),
      patchMethod(interactive, "addCompactionCostNotice", silence),
    ];
  }
  patchUsers++;

  pi.on("session_start", (_event, ctx) => {
    resetLiveItems();
    currentTheme = () => ctx.ui.theme;
    ctx.ui.setHiddenThinkingLabel("");
  });

  pi.on("message_update", (event) => {
    if (event.message.role === "assistant") updateLiveAssistant(event.message);
  });
  pi.on("tool_execution_start", (event) => {
    startLiveTool(event.toolCallId, event.toolName, event.args);
  });
  pi.on("tool_execution_update", (event) => {
    updateLiveTool(event.toolCallId, event.toolName, event.args, event.partialResult);
  });
  pi.on("tool_execution_end", (event) => {
    finishLiveTool(event.toolCallId, event.toolName, event.result, event.isError);
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") finishLiveAssistant(event.message);
    if (event.message.role === "toolResult") forgetLiveTool(event.message.toolCallId);
  });

  pi.on("session_tree", (_event, ctx) => {
    pruneLiveItems(ctx.sessionManager.getBranch());
  });

  pi.on("session_shutdown", () => {
    patchUsers--;
    if (patchUsers === 0) {
      for (const restore of restorePatches!.reverse()) restore();
      restorePatches = undefined;
      currentTheme = undefined;
    }
    resetLiveItems();
  });
}
