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

export type ThinkingRow = {
  traceKind: "thinking";
};

export type TraceRow = ToolRow | CustomRow | ThinkingRow;

const PREFIX_WIDTH = 3;

export function stripTerminalSequences(text: string): string {
  let output = "";
  let start = 0;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const isEscape = text[index] === "\x1b";
    if (!isEscape && (code < 0x80 || code > 0x9f)) continue;
    output += text.slice(start, index);

    const next = text[index + 1];
    const stringStart = isEscape
      ? next === "]" || next === "P" || next === "^" || next === "_" || next === "X"
      : code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f;
    if (stringStart) {
      index += isEscape ? 2 : 1;
      while (index < text.length) {
        if (text[index] === "\x07" || text.charCodeAt(index) === 0x9c) break;
        if (text[index] === "\x1b" && text[index + 1] === "\\") {
          index++;
          break;
        }
        index++;
      }
    } else if ((isEscape && next === "[") || code === 0x9b) {
      index += isEscape ? 2 : 1;
      while (index < text.length && !(/[\x40-\x7e]/.test(text[index]!))) index++;
    } else if (isEscape) {
      index++;
      while (index < text.length && /[\x20-\x2f]/.test(text[index]!)) index++;
    }
    start = index + 1;
  }

  return output + text.slice(start);
}

function isThinkingRow(row: TraceRow): row is ThinkingRow {
  return "traceKind" in row && row.traceKind === "thinking";
}

function isCustomRow(row: TraceRow): row is CustomRow {
  return "message" in row;
}

function traceName(row: TraceRow): string {
  if (isThinkingRow(row)) return "think";
  if (isCustomRow(row)) {
    const name = typeof row.message?.customType === "string" && row.message.customType ? row.message.customType : "extension";
    return stripTerminalSequences(name);
  }
  const name = typeof row.toolName === "string" && row.toolName ? row.toolName : "tool";
  return stripTerminalSequences(name);
}

function traceColor(row: TraceRow): "accent" | "success" | "error" | "customMessageLabel" | "thinkingText" {
  if (isThinkingRow(row)) return "thinkingText";
  if (isCustomRow(row)) return "customMessageLabel";
  return row.result?.isError ? "error" : row.result && row.isPartial !== true ? "success" : "accent";
}

function prefix(theme?: Theme): string {
  const bullet = theme?.fg("dim", "›") ?? "›";
  return ` ${bullet} `;
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
