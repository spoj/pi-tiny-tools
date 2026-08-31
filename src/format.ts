import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type ContentBlock = {
  type?: unknown;
  text?: unknown;
  mimeType?: unknown;
};

export type ToolRow = {
  toolName?: unknown;
  args?: unknown;
  result?: { content?: unknown; isError?: unknown };
  isPartial?: unknown;
  callRendererComponent?: { render?: (width: number) => unknown };
};

export type CustomRow = {
  message?: {
    customType?: unknown;
    content?: unknown;
  };
};

const CAPTURE_WIDTH = 10_000;
const PREFIX_WIDTH = 4;

export function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is ContentBlock => !!block && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value ?? "");
  }
}

function renderedInvocation(row: ToolRow): string | undefined {
  const render = row.callRendererComponent?.render;
  if (typeof render !== "function") return;
  const rendered = render.call(row.callRendererComponent, CAPTURE_WIDTH);
  if (!Array.isArray(rendered)) return;
  const lines = rendered.map((line) => stripTerminalSequences(String(line)).trim()).filter(Boolean);
  if (lines.length === 0) return;
  const selected = row.toolName === "bash" ? lines.join(" ↵ ") : lines[0];
  return selected.replace(/^•\s*/, "").replace(/\s+\(timeout [^)]+\)\s*$/i, "");
}

export function toolInvocation(row: ToolRow): string {
  const rendered = renderedInvocation(row);
  if (rendered) return rendered;
  const name = typeof row.toolName === "string" && row.toolName ? row.toolName : "tool";
  const args = compactJson(row.args ?? {});
  return args === "{}" || !args ? name : `${name} ${args}`;
}

export function resultChars(row: ToolRow): number | undefined {
  if (!row.result) return;
  return textContent(row.result.content).length;
}

function imageType(content: unknown): string | undefined {
  if (!Array.isArray(content)) return;
  const image = content.find((block) => block?.type === "image") as ContentBlock | undefined;
  if (!image) return;
  return typeof image.mimeType === "string" ? image.mimeType.replace(/^image\//, "") : "image";
}

function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function middleTruncate(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  if (width <= 1) return "…";
  const chars = Array.from(text);
  const leftBudget = Math.ceil((width - 1) / 2);
  const rightBudget = Math.floor((width - 1) / 2);
  let left = "";
  let right = "";
  for (const char of chars) {
    if (visibleWidth(left + char) > leftBudget) break;
    left += char;
  }
  for (let index = chars.length - 1; index >= 0; index--) {
    if (visibleWidth(chars[index] + right) > rightBudget) break;
    right = chars[index] + right;
  }
  return `${left}…${right}`;
}

function fitRow(prefix: string, body: string, suffix: string, width: number, preserveTail = false): string {
  const safeWidth = Math.max(1, width);
  const suffixWidth = visibleWidth(suffix);
  const gap = suffix ? 2 : 0;
  const bodyWidth = Math.max(1, safeWidth - PREFIX_WIDTH - suffixWidth - gap - 2);
  const fittedBody = preserveTail ? middleTruncate(body, bodyWidth) : truncateToWidth(body, bodyWidth, "…");
  const left = `${prefix}${fittedBody}`;
  if (!suffix || visibleWidth(left) + gap + suffixWidth > safeWidth) {
    return truncateToWidth(left, safeWidth, "…");
  }
  return `${left}${" ".repeat(safeWidth - visibleWidth(left) - suffixWidth)}${suffix}`;
}

function prefix(theme: Theme | undefined, tone: "running" | "success" | "error"): string {
  const bullet = theme?.fg(tone === "running" ? "accent" : tone, "›") ?? "›";
  return `  ${bullet} `;
}

export function renderToolRow(row: ToolRow, width: number, theme?: Theme): string[] {
  const tone = row.result?.isError ? "error" : row.result && row.isPartial !== true ? "success" : "running";
  const chars = resultChars(row);
  const image = imageType(row.result?.content);
  const fact = [image, chars === undefined || (image && chars === 0) ? undefined : `${compactCount(chars)} ch`]
    .filter(Boolean)
    .join(" · ");
  const suffix = !fact
    ? ""
    : theme?.fg(chars !== undefined && chars >= 50_000 ? "error" : chars !== undefined && chars >= 10_000 ? "warning" : "dim", fact) ?? fact;
  return [fitRow(prefix(theme, tone), toolInvocation(row), suffix, width, true)];
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
  const label = theme?.fg("customMessageLabel", theme.bold(`[${summary.label}]`)) ?? `[${summary.label}]`;
  const body = `${label} ${summary.text}`;
  const suffix = theme?.fg("dim", `${compactCount(summary.chars)} ch`) ?? `${compactCount(summary.chars)} ch`;
  const tone = /\b(?:fail|error|stop|abort)/i.test(summary.text)
    ? "error"
    : /\b(?:start|running|pending)/i.test(summary.text)
      ? "running"
      : "success";
  return ["", fitRow(prefix(theme, tone), body, suffix, width)];
}
