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
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { renderTraceGroup, stripTerminalSequences, TRACE_NAMES, type TraceRow } from "./format.ts";
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

type ShellComponent = {
  command: string;
  contentContainer: { children: unknown[] };
  status: "running" | "complete" | "cancelled" | "error";
  tinyToolsShellMarker?: "!" | "!!";
};

type InteractiveMessage = { role?: unknown; display?: unknown };

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

function traceRow(component: unknown): TraceRow | undefined {
  if (component instanceof ToolExecutionComponent) {
    if ((component as unknown as { hideComponent?: unknown }).hideComponent === true) return undefined;
    const tool = component as unknown as { toolName?: unknown; result?: { isError?: unknown }; isPartial?: unknown };
    const name = typeof tool.toolName === "string" && tool.toolName ? tool.toolName : "tool";
    return {
      name,
      color: tool.result?.isError ? "error" : tool.result && tool.isPartial !== true ? "success" : "accent",
    };
  }
  if (component instanceof CustomMessageComponent) {
    const customType = (component as unknown as { message?: { customType?: unknown } }).message?.customType;
    return {
      name: typeof customType === "string" && customType ? customType : "extension",
      color: "customMessageLabel",
    };
  }
  if (component instanceof BashExecutionComponent) {
    const shell = component as unknown as ShellComponent;
    return {
      name: shellMarker(shell),
      color: shell.status === "running" ? "accent" : shell.status === "complete" ? "success" : "error",
    };
  }
  if (component instanceof BranchSummaryMessageComponent) {
    return { name: TRACE_NAMES.branchSummary, color: "customMessageLabel" };
  }
  if (component instanceof CompactionSummaryMessageComponent) {
    return { name: TRACE_NAMES.compaction, color: "customMessageLabel" };
  }
  if (component instanceof SkillInvocationMessageComponent) {
    const skill = component as unknown as { skillBlock: { name: string } };
    return { name: skill.skillBlock.name, color: "customMessageLabel" };
  }
  const entry = customEntry(component);
  if (entry) {
    const name = typeof entry.customType === "string" && entry.customType ? entry.customType : "extension";
    return { name, color: "customMessageLabel" };
  }
  return undefined;
}

function hasThinking(component: unknown): boolean {
  if (!(component instanceof AssistantMessageComponent)) return false;
  const message = (component as unknown as { lastMessage?: { content?: Array<{ type?: unknown; thinking?: unknown }> } }).lastMessage;
  return message?.content?.some((part) => part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) === true;
}

function isSilent(component: unknown): boolean {
  if (!(component instanceof Text)) return false;
  const text = stripTerminalSequences((component as unknown as { text: string }).text);
  return /^(?:(?:Compaction|Branch summary): .* tokens billed|Cache miss(?: after .*?)?: .* tokens re-billed)/.test(text);
}

function renderTraceGroups(children: Array<{ render: (width: number) => string[] }>, width: number): string[] {
  const output: string[] = [];
  const traces: TraceRow[] = [];
  let pendingSpacing: string[] = [];
  let skipSilentSpacing = false;
  let silentTail = false;
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
      if (!skipSilentSpacing) pendingSpacing.push(...child.render(width));
      continue;
    }
    const row = traceRow(child);
    if (row) {
      traces.push(row);
      pendingSpacing = [];
      skipSilentSpacing = false;
      silentTail = false;
      continue;
    }
    if (isSilent(child)) {
      skipSilentSpacing = true;
      silentTail = true;
      continue;
    }

    skipSilentSpacing = false;
    silentTail = false;
    if (hasThinking(child)) {
      traces.push({ name: TRACE_NAMES.thinking, color: "thinkingText" });
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
  return silentTail ? output : [...output, ...pendingSpacing];
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
      patchMethod(AssistantMessageComponent.prototype, "render", (original) => function (this: AssistantMessageComponent, width: number) {
        const lines = original.call(this, width);
        if (!hasThinking(this)) return lines.every(isBlank) ? [] : lines;
        const firstContent = lines.findIndex((line) => !isBlank(line));
        return firstContent === -1 ? [] : lines.slice(firstContent);
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
        return this.children.some((child) => traceRow(child) !== undefined || isSilent(child) || hasThinking(child))
          ? renderTraceGroups(this.children, width)
          : original.call(this, width);
      }),
      patchMethod(
        InteractiveMode.prototype as unknown as {
          addMessageToChat(this: unknown, message: InteractiveMessage, options?: unknown): void;
        },
        "addMessageToChat",
        (original) => function (this: unknown, message: InteractiveMessage, options?: unknown): void {
          if (message.role === "custom" && !message.display) {
            original.call(this, { ...message, display: true }, options);
            return;
          }
          original.call(this, message, options);
        },
      ),
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
