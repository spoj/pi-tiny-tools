import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  SessionManager,
  ToolExecutionComponent,
  type ExtensionAPI,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { renderCustomRow, renderToolRow, renderTraceGroup, stripTerminalSequences, type CustomRow, type ToolRow, type TraceRow } from "./format.ts";
import { finishLiveThinking, resetLiveThinking, showTraceInspector, updateLiveThinking } from "./trace-inspector.ts";

type Render = (this: unknown, width: number) => string[];
type PatchedPrototype = {
  render: Render;
  __piTinyToolsOriginalRender?: Render;
  __piTinyToolsRender?: Render;
  __piTinyToolsHadOwnRender?: boolean;
  __piTinyToolsPatch?: "tool" | "custom";
};
type PatchedContainerPrototype = {
  render: Render;
  __piTinyToolsOriginalContainerRender?: Render;
  __piTinyToolsContainerRender?: Render;
};
type BuildContextEntries = (this: unknown) => SessionEntry[];
type PatchedSessionManagerPrototype = {
  buildContextEntries: BuildContextEntries;
  __piTinyToolsOriginalBuildContextEntries?: BuildContextEntries;
  __piTinyToolsBuildContextEntries?: BuildContextEntries;
};
type SetHideThinking = (this: unknown, hide: boolean) => void;
type UpdateAssistant = (this: unknown, message: unknown, isStreaming?: boolean) => void;
type PatchedAssistantPrototype = {
  render: Render;
  setHideThinkingBlock: SetHideThinking;
  updateContent: UpdateAssistant;
  __piTinyToolsOriginalAssistantRender?: Render;
  __piTinyToolsAssistantRender?: Render;
  __piTinyToolsOriginalSetHideThinking?: SetHideThinking;
  __piTinyToolsSetHideThinking?: SetHideThinking;
  __piTinyToolsOriginalUpdate?: UpdateAssistant;
  __piTinyToolsUpdate?: UpdateAssistant;
};

let currentTheme: (() => Theme | undefined) | undefined;

function patch(
  prototype: PatchedPrototype,
  kind: "tool" | "custom",
  compact: (row: unknown, width: number, theme?: Theme) => string[],
): void {
  if (prototype.__piTinyToolsPatch === kind) return;
  const original = prototype.__piTinyToolsOriginalRender ?? prototype.render;
  const wrapper: Render = function (width) {
    const row = this as { hideComponent?: unknown };
    if (kind === "tool" && row.hideComponent === true) return original.call(this, width);
    return compact(this, width, currentTheme?.());
  };
  prototype.__piTinyToolsOriginalRender = original;
  prototype.__piTinyToolsHadOwnRender = Object.hasOwn(prototype, "render");
  prototype.__piTinyToolsRender = wrapper;
  prototype.render = wrapper;
  prototype.__piTinyToolsPatch = kind;
}

function restore(prototype: PatchedPrototype, kind: "tool" | "custom"): void {
  const original = prototype.__piTinyToolsOriginalRender;
  if (prototype.__piTinyToolsPatch !== kind || !original || prototype.render !== prototype.__piTinyToolsRender) return;
  if (prototype.__piTinyToolsHadOwnRender) prototype.render = original;
  else delete (prototype as Partial<PatchedPrototype>).render;
  delete prototype.__piTinyToolsOriginalRender;
  delete prototype.__piTinyToolsRender;
  delete prototype.__piTinyToolsHadOwnRender;
  delete prototype.__piTinyToolsPatch;
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

// Trace rows can only be grouped where their parent combines sibling output.
function patchContainer(prototype: PatchedContainerPrototype): void {
  if (prototype.__piTinyToolsContainerRender) return;
  const original = prototype.render;
  const render: Render = function (width) {
    const children = (this as { children: Array<{ render: (width: number) => string[] }> }).children;
    return children.some((child) => isCompactTrace(child) || isQuietInternal(child) || hasThinking(child))
      ? renderTraceGroups(children, width)
      : original.call(this, width);
  };
  prototype.__piTinyToolsOriginalContainerRender = original;
  prototype.__piTinyToolsContainerRender = render;
  prototype.render = render;
}

function restoreContainer(prototype: PatchedContainerPrototype): void {
  const original = prototype.__piTinyToolsOriginalContainerRender;
  if (original && prototype.render === prototype.__piTinyToolsContainerRender) prototype.render = original;
  delete prototype.__piTinyToolsOriginalContainerRender;
  delete prototype.__piTinyToolsContainerRender;
}

function patchSessionManager(prototype: PatchedSessionManagerPrototype): void {
  if (prototype.__piTinyToolsBuildContextEntries) return;
  const original = prototype.buildContextEntries;
  const build: BuildContextEntries = function () {
    return original.call(this).map((entry) =>
      entry.type === "custom_message" && !entry.display ? { ...entry, display: true } : entry,
    );
  };
  prototype.__piTinyToolsOriginalBuildContextEntries = original;
  prototype.__piTinyToolsBuildContextEntries = build;
  prototype.buildContextEntries = build;
}

function restoreSessionManager(prototype: PatchedSessionManagerPrototype): void {
  const original = prototype.__piTinyToolsOriginalBuildContextEntries;
  if (original && prototype.buildContextEntries === prototype.__piTinyToolsBuildContextEntries) {
    prototype.buildContextEntries = original;
  }
  delete prototype.__piTinyToolsOriginalBuildContextEntries;
  delete prototype.__piTinyToolsBuildContextEntries;
}

function patchAssistant(prototype: PatchedAssistantPrototype): void {
  if (prototype.__piTinyToolsSetHideThinking) return;
  const originalRender = prototype.render;
  const render: Render = function (width) {
    const lines = originalRender.call(this, width);
    return lines.every(isBlank) ? [] : lines;
  };
  const originalSetHideThinking = prototype.setHideThinkingBlock;
  const setHideThinking: SetHideThinking = function () {
    originalSetHideThinking.call(this, true);
  };
  const originalUpdate = prototype.updateContent;
  const update: UpdateAssistant = function (message, isStreaming) {
    (this as { hideThinkingBlock: boolean }).hideThinkingBlock = true;
    originalUpdate.call(this, message, isStreaming);
  };
  prototype.__piTinyToolsOriginalAssistantRender = originalRender;
  prototype.__piTinyToolsAssistantRender = render;
  prototype.render = render;
  prototype.__piTinyToolsOriginalSetHideThinking = originalSetHideThinking;
  prototype.__piTinyToolsSetHideThinking = setHideThinking;
  prototype.setHideThinkingBlock = setHideThinking;
  prototype.__piTinyToolsOriginalUpdate = originalUpdate;
  prototype.__piTinyToolsUpdate = update;
  prototype.updateContent = update;
}

function restoreAssistant(prototype: PatchedAssistantPrototype): void {
  const originalRender = prototype.__piTinyToolsOriginalAssistantRender;
  if (originalRender && prototype.render === prototype.__piTinyToolsAssistantRender) prototype.render = originalRender;
  delete prototype.__piTinyToolsOriginalAssistantRender;
  delete prototype.__piTinyToolsAssistantRender;

  const originalSetHideThinking = prototype.__piTinyToolsOriginalSetHideThinking;
  if (originalSetHideThinking && prototype.setHideThinkingBlock === prototype.__piTinyToolsSetHideThinking) {
    prototype.setHideThinkingBlock = originalSetHideThinking;
  }
  delete prototype.__piTinyToolsOriginalSetHideThinking;
  delete prototype.__piTinyToolsSetHideThinking;

  const originalUpdate = prototype.__piTinyToolsOriginalUpdate;
  if (originalUpdate && prototype.updateContent === prototype.__piTinyToolsUpdate) prototype.updateContent = originalUpdate;
  delete prototype.__piTinyToolsOriginalUpdate;
  delete prototype.__piTinyToolsUpdate;
}

export default function tinyTools(pi: ExtensionAPI): void {
  pi.registerCommand("trace", {
    description: "Inspect tools, thinking, and custom messages",
    handler: async (_args, ctx) => showTraceInspector(ctx),
  });
  pi.registerShortcut("ctrl+t", {
    description: "Open the internal trace inspector",
    handler: showTraceInspector,
  });
  pi.registerShortcut("ctrl+o", {
    description: "Tool expansion is disabled by pi-tiny-tools",
    handler() {},
  });

  const toolPrototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
  const customPrototype = CustomMessageComponent.prototype as unknown as PatchedPrototype;
  const assistantPrototype = AssistantMessageComponent.prototype as unknown as PatchedAssistantPrototype;
  const containerPrototype = Container.prototype as unknown as PatchedContainerPrototype;
  const sessionManagerPrototype = SessionManager.prototype as unknown as PatchedSessionManagerPrototype;

  patch(toolPrototype, "tool", (row, width, theme) => renderToolRow(row as ToolRow, width, theme));
  patch(customPrototype, "custom", (row, width, theme) => renderCustomRow(row as CustomRow, width, theme));
  patchAssistant(assistantPrototype);
  patchContainer(containerPrototype);
  patchSessionManager(sessionManagerPrototype);

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
    restore(toolPrototype, "tool");
    restore(customPrototype, "custom");
    restoreAssistant(assistantPrototype);
    restoreContainer(containerPrototype);
    restoreSessionManager(sessionManagerPrototype);
    resetLiveThinking();
    currentTheme = undefined;
  });
}
