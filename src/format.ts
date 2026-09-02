import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type ToolRow = {
  toolName?: unknown;
  result?: { isError?: unknown };
  isPartial?: unknown;
};

export type CustomRow = {
  message?: { customType?: unknown };
};

export type TraceRow = ToolRow | CustomRow;

const PREFIX_WIDTH = 4;

export function stripTerminalSequences(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isCustomRow(row: TraceRow): row is CustomRow {
  return "message" in row;
}

function traceName(row: TraceRow): string {
  if (isCustomRow(row)) {
    return typeof row.message?.customType === "string" && row.message.customType ? row.message.customType : "extension";
  }
  return typeof row.toolName === "string" && row.toolName ? row.toolName : "tool";
}

function traceColor(row: TraceRow): "accent" | "success" | "error" | "customMessageLabel" {
  if (isCustomRow(row)) return "customMessageLabel";
  return row.result?.isError ? "error" : row.result && row.isPartial !== true ? "success" : "accent";
}

function prefix(theme?: Theme): string {
  const bullet = theme?.fg("dim", "›") ?? "›";
  return `  ${bullet} `;
}

export function renderTraceGroup(rows: TraceRow[], width: number, theme?: Theme): string[] {
  if (rows.length === 0) return [];
  const names = rows.map((row) => theme?.fg(traceColor(row), traceName(row)) ?? traceName(row)).join(" ");
  if (width <= PREFIX_WIDTH) return [truncateToWidth(`${prefix(theme)}${names}`, Math.max(1, width))];
  return wrapTextWithAnsi(names, width - PREFIX_WIDTH).map((line, index) =>
    `${index === 0 ? prefix(theme) : " ".repeat(PREFIX_WIDTH)}${line}`,
  );
}

export function renderToolRow(row: ToolRow, width: number, theme?: Theme): string[] {
  return renderTraceGroup([row], width, theme);
}

export function renderCustomRow(row: CustomRow, width: number, theme?: Theme): string[] {
  return renderTraceGroup([row], width, theme);
}
