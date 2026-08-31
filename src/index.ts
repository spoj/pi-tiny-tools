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
  __piTinyToolsRender?: Render;
  __piTinyToolsHadOwnRender?: boolean;
  __piTinyToolsPatch?: "tool" | "custom";
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
    const row = this as { expanded?: unknown; _expanded?: unknown; hideComponent?: unknown };
    const expanded = kind === "tool" ? row.expanded : row._expanded;
    if (expanded === true || (kind === "tool" && row.hideComponent === true)) {
      return original.call(this, width);
    }
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

export default function tinyTools(pi: ExtensionAPI): void {
  const toolPrototype = ToolExecutionComponent.prototype as unknown as PatchedPrototype;
  const customPrototype = CustomMessageComponent.prototype as unknown as PatchedPrototype;

  patch(toolPrototype, "tool", (row, width, theme) => renderToolRow(row as ToolRow, width, theme));
  patch(customPrototype, "custom", (row, width, theme) => renderCustomRow(row as CustomRow, width, theme));

  pi.on("session_start", (_event, ctx) => {
    currentTheme = () => ctx.ui.theme;
  });

  pi.on("session_shutdown", () => {
    restore(toolPrototype, "tool");
    restore(customPrototype, "custom");
    currentTheme = undefined;
  });
}
