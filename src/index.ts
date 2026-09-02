import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  SessionManager,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { renderCustomRow, renderToolRow, renderTraceGroup, stripTerminalSequences, type CustomRow, type ToolRow, type TraceRow } from "./format.ts";
import {
  finishLiveAssistant,
  finishLiveTool,
  resetLiveItems,
  showTraceInspector,
  startLiveTool,
  updateLiveAssistant,
  updateLiveTool,
} from "./trace-inspector.ts";

let currentTheme: (() => Theme | undefined) | undefined;
let tuiMode = false;
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

function isCompactTool(component: unknown): component is ToolExecutionComponent {
  return component instanceof ToolExecutionComponent
    && (component as unknown as { hideComponent?: unknown }).hideComponent !== true;
}

type ShellComponent = {
  command: string;
  contentContainer: { children: unknown[] };
  status: "running" | "complete" | "cancelled" | "error";
  tinyToolsShellMarker?: "!" | "!!";
};

function shellMarker(component: ShellComponent): "!" | "!!" {
  if (component.tinyToolsShellMarker) return component.tinyToolsShellMarker;
  const header = component.contentContainer.children[0] as { text?: unknown } | undefined;
  const theme = currentTheme?.();
  return theme && header?.text === theme.fg("dim", theme.bold(`$ ${component.command}`)) ? "!!" : "!";
}

function rememberShellMarker(component: BashExecutionComponent): void {
  const shell = component as unknown as ShellComponent;
  shell.tinyToolsShellMarker = shellMarker(shell);
}

function customEntry(component: unknown): { customType?: unknown } | undefined {
  const entry = (component as { entry?: { type?: unknown; customType?: unknown } } | undefined)?.entry;
  return entry?.type === "custom" ? entry : undefined;
}

function isCompactTrace(component: unknown): boolean {
  return isCompactTool(component)
    || component instanceof CustomMessageComponent
    || component instanceof BashExecutionComponent
    || component instanceof BranchSummaryMessageComponent
    || component instanceof CompactionSummaryMessageComponent
    || component instanceof SkillInvocationMessageComponent
    || customEntry(component) !== undefined;
}

function compactTraceRow(component: unknown): TraceRow {
  if (component instanceof BashExecutionComponent) {
    const shell = component as unknown as ShellComponent;
    return {
      traceKind: "named",
      name: shellMarker(shell),
      color: shell.status === "running" ? "accent" : shell.status === "complete" ? "success" : "error",
    };
  }
  if (component instanceof BranchSummaryMessageComponent) {
    return { traceKind: "named", name: "branch summary", color: "customMessageLabel" };
  }
  if (component instanceof CompactionSummaryMessageComponent) {
    return { traceKind: "named", name: "compaction", color: "customMessageLabel" };
  }
  if (component instanceof SkillInvocationMessageComponent) {
    const skill = component as unknown as { skillBlock: { name: string } };
    return { traceKind: "named", name: skill.skillBlock.name, color: "customMessageLabel" };
  }
  const entry = customEntry(component);
  if (entry) {
    const name = typeof entry.customType === "string" && entry.customType ? entry.customType : "extension";
    return { traceKind: "named", name, color: "customMessageLabel" };
  }
  return component as TraceRow;
}

function hasThinking(component: unknown): boolean {
  if (!(component instanceof AssistantMessageComponent)) return false;
  const message = (component as unknown as { lastMessage?: { content?: Array<{ type?: unknown; thinking?: unknown }> } }).lastMessage;
  return message?.content?.some((part) => part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) === true;
}

function isQuietInternal(component: unknown): boolean {
  if (!(component instanceof Text)) return false;
  const text = stripTerminalSequences((component as unknown as { text: string }).text);
  return /^(?:(?:Compaction|Branch summary): .* tokens billed|Cache miss(?: after .*?)?: .* tokens re-billed)/.test(text);
}

function renderTraceGroups(children: Array<{ render: (width: number) => string[] }>, width: number): string[] {
  const output: string[] = [];
  const traces: TraceRow[] = [];
  let pendingSpacing: string[] = [];
  let skipQuietSpacing = false;
  let quietTail = false;
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
      if (!skipQuietSpacing) pendingSpacing.push(...child.render(width));
      continue;
    }
    if (isCompactTrace(child)) {
      traces.push(compactTraceRow(child));
      pendingSpacing = [];
      skipQuietSpacing = false;
      quietTail = false;
      continue;
    }
    if (isQuietInternal(child)) {
      skipQuietSpacing = true;
      quietTail = true;
      continue;
    }

    skipQuietSpacing = false;
    quietTail = false;
    if (hasThinking(child)) {
      traces.push({ traceKind: "thinking" });
      pendingSpacing = [];
      const lines = child.render(width);
      if (lines.length > 0) {
        flushTraces();
        if (previous === "trace") output.push("");
        output.push(...lines);
        previous = "content";
      }
      continue;
    }

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
  return quietTail ? output : [...output, ...pendingSpacing];
}

export default function tinyTools(pi: ExtensionAPI): void {
  pi.registerCommand("trace", {
    description: "Inspect minimized transcript items",
    handler: async (_args, ctx) => showTraceInspector(ctx),
  });
  pi.registerShortcut("alt+t", {
    description: "Open the internal trace inspector",
    handler: showTraceInspector,
  });

  if (patchUsers === 0) {
    restorePatches = [
      patchMethod(BashExecutionComponent.prototype, "appendOutput", (original) => function (
        this: BashExecutionComponent,
        chunk: string,
      ) {
        rememberShellMarker(this);
        original.call(this, chunk);
      }),
      patchMethod(BashExecutionComponent.prototype, "setComplete", (original) => function (
        this: BashExecutionComponent,
        ...args: Parameters<BashExecutionComponent["setComplete"]>
      ) {
        rememberShellMarker(this);
        original.apply(this, args);
      }),
      patchMethod(ToolExecutionComponent.prototype, "render", (original) => function (this: ToolExecutionComponent, width: number) {
        if ((this as unknown as { hideComponent?: unknown }).hideComponent === true) return original.call(this, width);
        return renderToolRow(this as unknown as ToolRow, width, currentTheme?.());
      }),
      patchMethod(CustomMessageComponent.prototype, "render", () => function (this: CustomMessageComponent, width: number) {
        return renderCustomRow(this as unknown as CustomRow, width, currentTheme?.());
      }),
      patchMethod(AssistantMessageComponent.prototype, "render", (original) => function (this: AssistantMessageComponent, width: number) {
        const lines = original.call(this, width);
        if (!hasThinking(this)) return lines.every(isBlank) ? [] : lines;
        const firstContent = lines.findIndex((line) => !isBlank(line));
        return firstContent === -1 ? [] : lines.slice(firstContent);
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
          entry.type === "custom_message" && tuiMode && !entry.display ? { ...entry, display: true } : entry,
        );
      }),
    ];
  }
  patchUsers++;

  pi.on("session_start", (_event, ctx) => {
    resetLiveItems();
    tuiMode = ctx.mode === "tui";
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

  pi.on("message_end", (event, ctx) => {
    if (event.message.role === "assistant") finishLiveAssistant(event.message);
    if (ctx.mode === "tui" && event.message.role === "custom" && !event.message.display) {
      return { message: { ...event.message, display: true } };
    }
  });

  pi.on("session_shutdown", () => {
    patchUsers--;
    if (patchUsers === 0) {
      for (const restore of restorePatches!.reverse()) restore();
      restorePatches = undefined;
      currentTheme = undefined;
      tuiMode = false;
    }
    resetLiveItems();
  });
}
