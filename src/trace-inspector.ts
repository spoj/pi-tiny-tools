import type { ExtensionContext, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";

export type TraceItem = {
  id: string;
  kind: "tool" | "custom" | "thinking";
  name: string;
  status: "pending" | "success" | "error";
  hidden?: boolean;
  call?: unknown;
  output?: string;
  result?: unknown;
  details?: unknown;
};

export function ellipsizeId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 5)}…${id.slice(-4)}`;
}

type Content = string | Array<
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
>;

function contentValue(content: Content): string {
  if (typeof content === "string") return content;
  return content.map((part) => part.type === "text"
    ? part.text
    : `[image ${part.mimeType}, ${part.data.length} base64 characters]`
  ).join("\n");
}

export function extractTraceItems(entries: SessionEntry[]): TraceItem[] {
  const items: TraceItem[] = [];
  const tools = new Map<string, TraceItem>();

  for (const entry of entries) {
    if (entry.type === "custom_message") {
      items.push({
        id: entry.id,
        kind: "custom",
        name: entry.customType,
        status: "success",
        hidden: !entry.display,
        output: contentValue(entry.content),
        details: entry.details,
      });
      continue;
    }

    if (entry.type !== "message") continue;
    if (entry.message.role === "assistant") {
      for (let index = 0; index < entry.message.content.length; index++) {
        const part = entry.message.content[index]!;
        if (part.type === "thinking") {
          const blocks: string[] = [];
          while (index < entry.message.content.length) {
            const thinking = entry.message.content[index]!;
            if (thinking.type !== "thinking") break;
            if (thinking.thinking.trim()) blocks.push(thinking.thinking);
            index++;
          }
          index--;
          if (blocks.length > 0) {
            items.push({
              id: `${entry.id}:thinking:${index}`,
              kind: "thinking",
              name: "think",
              status: "success",
              output: blocks.join("\n\n"),
            });
          }
        } else if (part.type === "toolCall") {
          const item: TraceItem = {
            id: part.id,
            kind: "tool",
            name: part.name,
            status: entry.message.stopReason === "aborted" || entry.message.stopReason === "error" ? "error" : "pending",
            call: { id: ellipsizeId(part.id), name: part.name, arguments: part.arguments },
          };
          items.push(item);
          tools.set(part.id, item);
        }
      }
      continue;
    }

    if (entry.message.role === "toolResult") {
      const item = tools.get(entry.message.toolCallId);
      if (!item) continue;
      item.status = entry.message.isError ? "error" : "success";
      item.output = contentValue(entry.message.content);
      item.result = {
        toolCallId: ellipsizeId(entry.message.toolCallId),
        toolName: entry.message.toolName,
        isError: entry.message.isError,
        timestamp: entry.message.timestamp,
        ...(entry.message.usage === undefined ? {} : { usage: entry.message.usage }),
        ...(entry.message.addedToolNames === undefined ? {} : { addedToolNames: entry.message.addedToolNames }),
      };
      item.details = entry.message.details;
    }
  }

  return items;
}

function formatValue(value: unknown): string[] {
  if (typeof value === "string") return value.split("\n");
  const json = JSON.stringify(value, null, 2);
  return json === undefined ? [] : json.split("\n");
}

export function traceContent(item: TraceItem): string[] {
  const lines: string[] = [];
  const add = (heading: string, value: unknown): void => {
    const content = formatValue(value);
    if (content.length === 0) return;
    if (lines.length > 0) lines.push("");
    lines.push(heading, ...content);
  };

  add("CALL", item.call);
  add("OUTPUT", item.output);
  add("RESULT", item.result);
  add("DETAILS", item.details);
  return lines.length > 0 ? lines : ["No content"];
}

function fit(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

type ThinkingMessage = {
  timestamp: number;
  content: Array<{ type: string; thinking?: string }>;
};

let liveThinking: TraceItem | undefined;
let activeInspector: TraceInspector | undefined;

function thinkingText(message: ThinkingMessage): string {
  return message.content
    .filter((part): part is { type: string; thinking: string } => part.type === "thinking" && typeof part.thinking === "string")
    .map((part) => part.thinking)
    .filter((text) => text.trim())
    .join("\n\n");
}

export function updateLiveThinking(message: ThinkingMessage): void {
  const output = thinkingText(message);
  if (!output) return;
  const id = `live-thinking:${message.timestamp}`;
  if (liveThinking?.id !== id) {
    liveThinking = { id, kind: "thinking", name: "think", status: "pending", output };
  } else {
    liveThinking.output = output;
  }
  activeInspector?.updateLiveThinking(liveThinking);
}

export function finishLiveThinking(message: ThinkingMessage): void {
  updateLiveThinking(message);
  if (!liveThinking || liveThinking.id !== `live-thinking:${message.timestamp}`) return;
  liveThinking.status = "success";
  activeInspector?.updateLiveThinking(liveThinking);
  liveThinking = undefined;
}

export function resetLiveThinking(): void {
  liveThinking = undefined;
  activeInspector = undefined;
}

export class TraceInspector implements Component {
  private readonly items: TraceItem[];
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly done: () => void;
  private selected: number;
  private scroll = 0;

  constructor(items: TraceItem[], theme: Theme, tui: TUI, done: () => void) {
    this.items = items;
    this.theme = theme;
    this.tui = tui;
    this.done = done;
    this.selected = items.length - 1;
  }

  updateLiveThinking(item: TraceItem): void {
    const index = this.items.findIndex((candidate) => candidate.id === item.id);
    if (index === -1) {
      const wasNewest = this.selected === this.items.length - 1;
      this.items.push(item);
      if (wasNewest) this.selected = this.items.length - 1;
    } else {
      this.items[index] = item;
    }
    if (this.items[this.selected]?.id === item.id) this.scroll = Number.MAX_SAFE_INTEGER;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }
    if ((data === "j" || matchesKey(data, "down")) && this.selected < this.items.length - 1) {
      this.selected++;
      this.scroll = 0;
    } else if ((data === "k" || matchesKey(data, "up")) && this.selected > 0) {
      this.selected--;
      this.scroll = 0;
    } else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) {
      this.scroll += this.bodyHeight();
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) {
      this.scroll = Math.max(0, this.scroll - this.bodyHeight());
    } else if (data === "g" || matchesKey(data, "home")) {
      this.scroll = 0;
    } else if (data === "G" || matchesKey(data, "end")) {
      this.scroll = Number.MAX_SAFE_INTEGER;
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (width < 4) return [truncateToWidth(this.items[this.selected]!.name, width, "")];
    const innerWidth = width - 2;
    const bodyWidth = Math.max(1, innerWidth - 2);
    const item = this.items[this.selected]!;
    const content = traceContent(item).flatMap((line) => wrapTextWithAnsi(line || " ", bodyWidth));
    const bodyHeight = this.bodyHeight();
    const maxScroll = Math.max(0, content.length - bodyHeight);
    this.scroll = Math.min(this.scroll, maxScroll);

    const color = item.kind === "thinking"
      ? "thinkingText"
      : item.status === "error"
        ? "error"
        : item.status === "pending"
          ? "accent"
          : item.kind === "custom"
            ? "customMessageLabel"
            : "success";
    const state = item.kind === "custom" ? (item.hidden ? "hidden" : "visible") : item.status;
    const title = ` trace ${this.selected + 1}/${this.items.length} · ${item.kind} · ${this.theme.fg(color, item.name)} · ${state} `;
    const border = (left: string, fill: string, right: string) => this.theme.fg("border", left + fill.repeat(innerWidth) + right);
    const row = (text = "") => this.theme.fg("border", "│") + fit(text, innerWidth) + this.theme.fg("border", "│");
    const lines = [
      border("╭", "─", "╮"),
      row(title),
      border("├", "─", "┤"),
    ];

    for (let index = 0; index < bodyHeight; index++) {
      const line = content[this.scroll + index] ?? "";
      lines.push(row(` ${fit(line, bodyWidth)} `));
    }

    lines.push(border("├", "─", "┤"));
    lines.push(row(this.theme.fg("dim", " j/k item · PgUp/PgDn scroll · g/G top/bottom · Esc close")));
    lines.push(border("╰", "─", "╯"));
    return lines;
  }

  invalidate(): void {}

  private bodyHeight(): number {
    return Math.max(1, Math.floor(this.tui.terminal.rows * 0.9) - 6);
  }
}

export async function showTraceInspector(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") return;
  const items = extractTraceItems(ctx.sessionManager.getBranch());
  if (liveThinking && !items.some((item) => item.id === liveThinking?.id)) items.push(liveThinking);
  if (items.length === 0) {
    ctx.ui.notify("No tools, thinking, or custom messages in the current branch", "info");
    return;
  }

  try {
    await ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) => {
        activeInspector = new TraceInspector(items, theme, tui, done);
        return activeInspector;
      },
      {
        overlay: true,
        overlayOptions: () => ({ width: "90%", minWidth: 40, maxHeight: "90%", margin: 1 }),
      },
    );
  } finally {
    activeInspector = undefined;
  }
}
