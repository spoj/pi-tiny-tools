import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  SessionManager,
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { renderCustomRow, renderToolRow, renderTraceGroup, stripTerminalSequences, type CustomRow, type ToolRow, type TraceRow } from "./format.ts";
import { finishLiveThinking, resetLiveThinking, showTraceInspector, updateLiveThinking } from "./trace-inspector.ts";

let currentTheme: (() => Theme | undefined) | undefined;

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

function isCompactTool(component: unknown): component is ToolExecutionComponent {
  return component instanceof ToolExecutionComponent
    && (component as unknown as { hideComponent?: unknown }).hideComponent !== true;
}

function isCompactTrace(component: unknown): boolean {
  return isCompactTool(component) || component instanceof CustomMessageComponent;
}

function hasThinking(component: unknown): boolean {
  if (!(component instanceof AssistantMessageComponent)) return false;
  const message = (component as unknown as { lastMessage?: { content?: Array<{ type?: unknown; thinking?: unknown }> } }).lastMessage;
  return message?.content?.some((part) => part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) === true;
}

function isQuietInternal(component: unknown): boolean {
  if (
    component instanceof BashExecutionComponent
    || component instanceof BranchSummaryMessageComponent
    || component instanceof CompactionSummaryMessageComponent
  ) return true;
  const entry = (component as { entry?: { type?: unknown } } | undefined)?.entry;
  if (entry?.type === "custom") return true;
  if (!(component instanceof Text)) return false;
  const text = stripTerminalSequences((component as unknown as { text: string }).text);
  return /^(?:(?:Compaction|Branch summary): .* tokens billed|Cache miss(?: after .*?)?: .* tokens re-billed)/.test(text);
}

function renderTraceGroups(children: Array<{ render: (width: number) => string[] }>, width: number): string[] {
  const output: string[] = [];
  const traces: TraceRow[] = [];
  let pendingSpacing: string[] = [];
  let skipQuietSpacing = false;
  let previous: "content" | "trace" | undefined;

  const flushTraces = (): void => {
    if (traces.length === 0) return;
    if (previous === "content") output.push("");
    output.push(...renderTraceGroup(traces, width, currentTheme?.()));
    traces.length = 0;
    previous = "trace";
  };

  for (const child of children) {
    if (child instanceof Spacer) {
      if (!skipQuietSpacing || pendingSpacing.length === 0) pendingSpacing.push(...child.render(width));
      skipQuietSpacing = false;
      continue;
    }
    if (isCompactTrace(child)) {
      traces.push(child as unknown as TraceRow);
      pendingSpacing = [];
      continue;
    }
    if (isQuietInternal(child)) {
      skipQuietSpacing = true;
      continue;
    }
    if (hasThinking(child)) {
      traces.push({ traceKind: "thinking" });
      pendingSpacing = [];
      const lines = child.render(width);
      if (lines.length > 0) {
        flushTraces();
        output.push(...lines);
        previous = "content";
      }
      continue;
    }

    skipQuietSpacing = false;
    const lines = child.render(width);
    if (lines.length === 0) {
      pendingSpacing.push(...lines);
      continue;
    }

    flushTraces();
    output.push(...pendingSpacing, ...lines);
    pendingSpacing = [];
    previous = "content";
  }

  flushTraces();
  return [...output, ...pendingSpacing];
}

export default function tinyTools(pi: ExtensionAPI): void {
  pi.registerCommand("trace", {
    description: "Inspect tools, thinking, and custom messages",
    handler: async (_args, ctx) => showTraceInspector(ctx),
  });
  pi.registerShortcut("alt+t", {
    description: "Open the internal trace inspector",
    handler: showTraceInspector,
  });

  const restores = [
    patchMethod(ToolExecutionComponent.prototype, "render", (original) => function (this: ToolExecutionComponent, width: number) {
      if ((this as unknown as { hideComponent?: unknown }).hideComponent === true) return original.call(this, width);
      return renderToolRow(this as unknown as ToolRow, width, currentTheme?.());
    }),
    patchMethod(CustomMessageComponent.prototype, "render", () => function (this: CustomMessageComponent, width: number) {
      return renderCustomRow(this as unknown as CustomRow, width, currentTheme?.());
    }),
    patchMethod(AssistantMessageComponent.prototype, "render", (original) => function (this: AssistantMessageComponent, width: number) {
      const lines = original.call(this, width);
      return lines.every(isBlank) ? [] : lines;
    }),
    patchMethod(AssistantMessageComponent.prototype, "setHideThinkingBlock", (original) => function (this: AssistantMessageComponent) {
      original.call(this, true);
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
      return this.children.some((child) => isCompactTrace(child) || isQuietInternal(child) || hasThinking(child))
        ? renderTraceGroups(this.children, width)
        : original.call(this, width);
    }),
    patchMethod(SessionManager.prototype, "buildContextEntries", (original) => function (this: SessionManager) {
      return original.call(this).map((entry) =>
        entry.type === "custom_message" && !entry.display ? { ...entry, display: true } : entry,
      );
    }),
  ];

  pi.on("session_start", (_event, ctx) => {
    resetLiveThinking();
    currentTheme = () => ctx.ui.theme;
    ctx.ui.setHiddenThinkingLabel("");
  });

  pi.on("message_update", (event) => {
    if (event.message.role === "assistant") updateLiveThinking(event.message);
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") finishLiveThinking(event.message);
    if (event.message.role === "custom" && !event.message.display) {
      return { message: { ...event.message, display: true } };
    }
  });

  pi.on("session_shutdown", () => {
    for (const restore of restores.reverse()) restore();
    resetLiveThinking();
    currentTheme = undefined;
  });
}
