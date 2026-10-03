import { getMarkdownTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { formatTime, messageText, stripTerminalSequences, type TraceRow } from "./format.ts";

export type TraceItem = { component: Component; row: TraceRow; time?: number; model?: string };

type Expandable = { setExpanded?(expanded: boolean): void };

function fit(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export class TraceInspector implements Component {
  private readonly items: () => TraceItem[];
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly done: () => void;
  private readonly thinking: Markdown;
  private thinkingSource = "";
  private selected: Component | undefined;
  private expanded: Component | undefined;
  private followNewest = true;
  private scroll = 0;
  private pinned = false;

  constructor(items: () => TraceItem[], theme: Theme, tui: TUI, done: () => void) {
    this.items = items;
    this.theme = theme;
    this.tui = tui;
    this.done = done;
    this.thinking = new Markdown("", 1, 0, getMarkdownTheme(), { color: (text) => theme.fg("thinkingText", text), italic: true });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "alt+t")) {
      this.done();
      return;
    }
    const items = this.items();
    const index = items.findIndex((item) => item.component === this.selected);
    if (data === "j" || matchesKey(data, "down")) this.select(items, index + 1);
    else if (data === "k" || matchesKey(data, "up")) this.select(items, index - 1);
    else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) this.scrollBy(this.bodyHeight());
    else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) this.scrollBy(-this.bodyHeight());
    else if (data === "g" || matchesKey(data, "home")) this.scrollBy(-this.scroll);
    else if (data === "G" || matchesKey(data, "end")) this.pinned = true;
    this.tui.requestRender();
  }

  handleMouse(event: TuiMouseEvent) {
    if (event.type !== "wheel") return undefined;
    this.scrollBy(event.wheelDelta ?? 0);
    return { handled: true };
  }

  render(width: number): string[] {
    const items = this.items();
    let index = items.findIndex((item) => item.component === this.selected);
    if (index === -1 || (this.followNewest && index < items.length - 1)) {
      index = items.length - 1;
      this.select(items, index);
    }
    const item = items[index];
    if (item && item.component !== this.expanded) {
      (item.component as Expandable).setExpanded?.(true);
      this.expanded = item.component;
    }

    const content = item ? this.renderItem(item.component, width) : [];
    const height = this.bodyHeight();
    const maxScroll = Math.max(0, content.length - height);
    if (this.pinned) this.scroll = maxScroll;
    this.scroll = Math.min(this.scroll, maxScroll);
    this.pinned = this.scroll === maxScroll;

    const about = [item?.time === undefined ? undefined : formatTime(item.time), item?.model].filter(Boolean).join(" · ");
    const title = item
      ? `trace ${index + 1}/${items.length} · ${this.theme.fg(item.row.color, stripTerminalSequences(item.row.name))}${about ? this.theme.fg("dim", ` · ${about}`) : ""}`
      : "trace";
    const position = maxScroll > 0 ? `${this.scroll + 1}–${this.scroll + height} of ${content.length}` : "";
    return [
      this.rule(title, position, width),
      ...Array.from({ length: height }, (_, row) => fit(content[this.scroll + row] ?? "", width)),
      this.rule(this.theme.fg("dim", "j/k item · PgUp/PgDn scroll · g/G top/bottom · Esc close"), "", width),
    ];
  }

  invalidate(): void {
    this.thinking.invalidate();
  }

  private select(items: TraceItem[], index: number): void {
    if (index < 0 || index >= items.length) return;
    this.selected = items[index]!.component;
    this.followNewest = index === items.length - 1;
    this.scroll = 0;
    this.pinned = false;
  }

  private scrollBy(lines: number): void {
    this.scroll = Math.max(0, this.scroll + lines);
    this.pinned = false;
  }

  private renderItem(component: Component, width: number): string[] {
    const thinking = messageText(component, "thinking");
    if (!thinking) return component.render(width);
    if (thinking !== this.thinkingSource) {
      this.thinkingSource = thinking;
      this.thinking.setText(thinking);
    }
    return ["", ...this.thinking.render(width)];
  }

  private rule(left: string, right: string, width: number): string {
    const border = (text: string) => this.theme.fg("border", text);
    const tail = right ? ` ${this.theme.fg("dim", right)} ${border("─")}` : border("─");
    const fill = width - visibleWidth(left) - visibleWidth(tail) - 3;
    return fit(`${border("─")} ${left} ${border("─".repeat(Math.max(0, fill)))}${tail}`, width);
  }

  private bodyHeight(): number {
    return Math.max(1, this.tui.terminal.rows - 2);
  }
}

export async function showTraceInspector(ctx: ExtensionContext, items: () => TraceItem[]): Promise<void> {
  if (ctx.mode !== "tui") return;
  if (items().length === 0) {
    ctx.ui.notify("No traceable items in the current branch", "info");
    return;
  }
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => new TraceInspector(items, theme, tui, done), {
    overlay: true,
    overlayOptions: { width: "100%", maxHeight: "100%" },
  });
}
