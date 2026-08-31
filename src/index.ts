import {
  CustomMessageComponent,
  ToolExecutionComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { renderCustomRow, renderToolRow, type CustomRow, type ToolRow } from "./format.ts";

type Render = (this: unknown, width: number) => string[];
type PatchedPrototype = {
  render: Render;
  __piTinyToolsOriginalRender?: Render;
  __piTinyToolsPatch?: "tool" | "custom";
};

type Globals = typeof globalThis & {
  __piTinyToolsTheme?: () => Theme | undefined;
};

const globals = globalThis as Globals;

function patch(
  prototype: PatchedPrototype,
  kind: "tool" | "custom",
  compact: (row: unknown, width: number, theme?: Theme) => string[],
): void {
  if (prototype.__piTinyToolsPatch === kind) return;
  const original = prototype.__piTinyToolsOriginalRender ?? prototype.render;
  prototype.__piTinyToolsOriginalRender = original;
  prototype.render = function (width) {
    const expanded = kind === "tool"
      ? (this as { expanded?: unknown }).expanded
      : (this as { _expanded?: unknown })._expanded;
    if (expanded === true) return original.call(this, width);
    try {
      return compact(this, width, globals.__piTinyToolsTheme?.());
    } catch {
      return original.call(this, width);
    }
  };
  prototype.__piTinyToolsPatch = kind;
}

function restore(prototype: PatchedPrototype, kind: "tool" | "custom"): void {
  if (prototype.__piTinyToolsPatch !== kind || !prototype.__piTinyToolsOriginalRender) return;
  prototype.render = prototype.__piTinyToolsOriginalRender;
  delete prototype.__piTinyToolsOriginalRender;
  delete prototype.__piTinyToolsPatch;
}

export default function tinyTools(pi: ExtensionAPI): void {
  const toolPrototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
  const customPrototype = CustomMessageComponent.prototype as unknown as PatchedPrototype;

  patch(toolPrototype, "tool", (row, width, theme) => renderToolRow(row as ToolRow, width, theme));
  patch(customPrototype, "custom", (row, width, theme) => renderCustomRow(row as CustomRow, width, theme));

  pi.on("session_start", (_event, ctx) => {
    globals.__piTinyToolsTheme = () => ctx.ui.theme;
  });

  pi.on("session_shutdown", () => {
    restore(toolPrototype, "tool");
    restore(customPrototype, "custom");
    globals.__piTinyToolsTheme = undefined;
  });
}
