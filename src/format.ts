import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type ContentBlock = {
  type?: unknown;
  text?: unknown;
};

export type ToolRow = {
  toolName?: unknown;
  result?: { isError?: unknown };
  isPartial?: unknown;
};

export type CustomRow = {
  message?: {
    customType?: unknown;
    content?: unknown;
  };
};

const PREFIX_WIDTH = 4;

export function stripTerminalSequences(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock => !!block && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function fitRow(prefix: string, body: string, suffix: string, width: number): string {
  const safeWidth = Math.max(1, width);
  const suffixWidth = visibleWidth(suffix);
  const gap = suffix ? 2 : 0;
  const bodyWidth = Math.max(1, safeWidth - PREFIX_WIDTH - suffixWidth - gap - 2);
  const fittedBody = truncateToWidth(body, bodyWidth, "…");
  const left = `${prefix}${fittedBody}`;
  if (!suffix || visibleWidth(left) + gap + suffixWidth > safeWidth) {
    return truncateToWidth(left, safeWidth, "…");
  }
  return `${left}${" ".repeat(safeWidth - visibleWidth(left) - suffixWidth)}${suffix}`;
}

type LabelColor = "accent" | "success" | "error" | "customMessageLabel";

function prefix(theme: Theme | undefined, color: LabelColor): string {
  const bullet = theme?.fg(color, "›") ?? "›";
  return `  ${bullet} `;
}

function toolColor(row: ToolRow): LabelColor {
  return row.result?.isError ? "error" : row.result && row.isPartial !== true ? "success" : "accent";
}

function toolName(row: ToolRow): string {
  return typeof row.toolName === "string" && row.toolName ? row.toolName : "tool";
}

export function renderToolGroup(rows: ToolRow[], width: number, theme?: Theme): string[] {
  if (rows.length === 0) return [];
  const names = rows.map((row) => theme?.fg(toolColor(row), toolName(row)) ?? toolName(row)).join(" ");
  if (width <= PREFIX_WIDTH) return [truncateToWidth(`${prefix(theme, toolColor(rows[0]))}${names}`, Math.max(1, width))];
  return wrapTextWithAnsi(names, width - PREFIX_WIDTH).map((line, index) =>
    `${index === 0 ? prefix(theme, toolColor(rows[0])) : " ".repeat(PREFIX_WIDTH)}${line}`,
  );
}

export function renderToolRow(row: ToolRow, width: number, theme?: Theme): string[] {
  return renderToolGroup([row], width, theme);
}

export function customSummary(row: CustomRow): { label: string; text: string; chars: number } {
  const label = typeof row.message?.customType === "string" ? row.message.customType : "extension";
  const content = textContent(row.message?.content);
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let text = lines[0] ?? "(no text)";
  const result = lines.findIndex((line) => line === "Result:" || line.startsWith("Result: "));
  if (result >= 0) {
    const value = lines[result].slice("Result:".length).trim() || lines[result + 1];
    if (value) text += ` · Result: ${value}`;
  }
  return { label, text, chars: content.length };
}

export function renderCustomRow(row: CustomRow, width: number, theme?: Theme): string[] {
  const summary = customSummary(row);
  const color = "customMessageLabel";
  const label = theme?.fg(color, theme.bold(`[${summary.label}]`)) ?? `[${summary.label}]`;
  const text = theme?.fg("muted", summary.text) ?? summary.text;
  const body = `${label} ${text}`;
  const suffix = theme?.fg("dim", `${compactCount(summary.chars)} ch`) ?? `${compactCount(summary.chars)} ch`;
  return [fitRow(prefix(theme, color), body, suffix, width)];
}
