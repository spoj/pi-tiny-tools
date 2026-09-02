import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer } from "@earendil-works/pi-tui";
import { renderCustomRow, renderToolGroup, renderToolRow, stripTerminalSequences, type CustomRow, type ToolRow } from "./format.ts";

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
type SetHideThinking = (this: unknown, hide: boolean) => void;
type PatchedAssistantPrototype = {
  render: Render;
  setHideThinkingBlock: SetHideThinking;
  __piTinyToolsOriginalAssistantRender?: Render;
  __piTinyToolsAssistantRender?: Render;
  __piTinyToolsOriginalSetHideThinking?: SetHideThinking;
  __piTinyToolsSetHideThinking?: SetHideThinking;
};

let currentTheme: (() => Theme | undefined) | undefined;
let compactDisplay = false;

function patch(
  prototype: PatchedPrototype,
  kind: "tool" | "custom",
  compact: (row: unknown, width: number, theme?: Theme) => string[],
): void {
  if (prototype.__piTinyToolsPatch === kind) return;
  const original = prototype.__piTinyToolsOriginalRender ?? prototype.render;
  const wrapper: Render = function (width) {
    const row = this as { hideComponent?: unknown };
    if (!compactDisplay || (kind === "tool" && row.hideComponent === true)) return original.call(this, width);
    try {
      return compact(this, width, currentTheme?.());
    } catch {
      return original.call(this, width);
    }
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
  return compactDisplay
    && component instanceof ToolExecutionComponent
    && (component as unknown as { hideComponent?: unknown }).hideComponent !== true;
}

function isCompactTrace(component: unknown): boolean {
  return isCompactTool(component) || (compactDisplay && component instanceof CustomMessageComponent);
}

function renderTraceGroups(children: Array<{ render: (width: number) => string[] }>, width: number): string[] {
  const output: string[] = [];
  const tools: ToolRow[] = [];
  let pendingSpacing: string[] = [];
  let previous: "content" | "trace" | undefined;

  const flushTools = (): void => {
    if (tools.length === 0) return;
    if (previous === "content") output.push("");
    output.push(...renderToolGroup(tools, width, currentTheme?.()));
    tools.length = 0;
    previous = "trace";
  };

  for (const child of children) {
    if (child instanceof Spacer) {
      pendingSpacing.push(...child.render(width));
      continue;
    }
    if (isCompactTool(child)) {
      tools.push(child as unknown as ToolRow);
      pendingSpacing = [];
      continue;
    }

    const lines = child.render(width);
    if (lines.length === 0) {
      pendingSpacing.push(...lines);
      continue;
    }

    flushTools();
    const current = isCompactTrace(child) ? "trace" : "content";
    if (current === "content") output.push(...pendingSpacing);
    else if (previous === "content") output.push("");
    output.push(...lines);
    pendingSpacing = [];
    previous = current;
  }

  flushTools();
  return [...output, ...pendingSpacing];
}

// Trace rows can only be grouped where their parent combines sibling output.
function patchContainer(prototype: PatchedContainerPrototype): void {
  if (prototype.__piTinyToolsContainerRender) return;
  const original = prototype.render;
  const render: Render = function (width) {
    const children = (this as { children: Array<{ render: (width: number) => string[] }> }).children;
    const assistant = [...children].reverse().find((child) => child instanceof AssistantMessageComponent) as
      | { hideThinkingBlock?: unknown }
      | undefined;
    if (assistant) compactDisplay = assistant.hideThinkingBlock === true;
    return children.some(isCompactTrace) ? renderTraceGroups(children, width) : original.call(this, width);
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

function patchAssistant(prototype: PatchedAssistantPrototype): void {
  if (prototype.__piTinyToolsSetHideThinking) return;
  const originalRender = prototype.render;
  const render: Render = function (width) {
    compactDisplay = (this as { hideThinkingBlock?: unknown }).hideThinkingBlock === true;
    const lines = originalRender.call(this, width);
    return lines.every(isBlank) ? [] : lines;
  };
  const originalSetHideThinking = prototype.setHideThinkingBlock;
  const setHideThinking: SetHideThinking = function (hide) {
    compactDisplay = hide;
    originalSetHideThinking.call(this, hide);
  };
  prototype.__piTinyToolsOriginalAssistantRender = originalRender;
  prototype.__piTinyToolsAssistantRender = render;
  prototype.render = render;
  prototype.__piTinyToolsOriginalSetHideThinking = originalSetHideThinking;
  prototype.__piTinyToolsSetHideThinking = setHideThinking;
  prototype.setHideThinkingBlock = setHideThinking;
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
}

export default function tinyTools(pi: ExtensionAPI): void {
  const toolPrototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
  const customPrototype = CustomMessageComponent.prototype as unknown as PatchedPrototype;
  const assistantPrototype = AssistantMessageComponent.prototype as unknown as PatchedAssistantPrototype;
  const containerPrototype = Container.prototype as unknown as PatchedContainerPrototype;

  patch(toolPrototype, "tool", (row, width, theme) => renderToolRow(row as ToolRow, width, theme));
  patch(customPrototype, "custom", (row, width, theme) => renderCustomRow(row as CustomRow, width, theme));
  patchAssistant(assistantPrototype);
  patchContainer(containerPrototype);

  pi.on("session_start", (_event, ctx) => {
    currentTheme = () => ctx.ui.theme;
    ctx.ui.setHiddenThinkingLabel("");
  });

  pi.on("session_shutdown", () => {
    restore(toolPrototype, "tool");
    restore(customPrototype, "custom");
    restoreAssistant(assistantPrototype);
    restoreContainer(containerPrototype);
    currentTheme = undefined;
    compactDisplay = false;
  });
}
