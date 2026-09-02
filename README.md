# pi-tiny-tools

A small [Pi](https://github.com/earendil-works/pi-mono) extension that reduces Pi's internal activity—tool calls, thinking, and extension messages—to colored names.

```text
 › think read bash pi-subagents think edit write
```

The transcript has three visibility levels:

- **Full:** user messages, assistant messages, and assistant error notices.
- **Minimized and traceable:** thinking, tools, skill invocations, custom messages, custom entries, `!` and `!!` shell executions, compactions, and branch summaries. These render as compact names and retain their full content in `/trace`.
- **Silent:** model changes, thinking-level changes, and billing notices. These add no transcript item.

Internal names share one layout and flow onto indented continuation lines when needed. Thinking uses Pi's native thinking color. Compact traces have one leading blank line and no blank rows between items.

Run `/trace` or press `Alt+T` to inspect minimized items from the current session branch in a Pi overlay. It opens on the newest item and follows new thinking, tool calls, and tool output while they stream. Pi's native `Ctrl+T` and `Ctrl+O` toggles remain available; their display effects are intentionally invisible while the compact trace renderer is active.

- `j` / `k`: next / previous item
- `PageDown` / `PageUp` or `Ctrl+D` / `Ctrl+U`: scroll the current item
- `g` / `G`: top / bottom
- `Esc`: close

The inspector shows the complete retained content for traceable items. It cannot recover output that a tool discarded before returning; when a tool truncates output, its stored result and truncation details are shown.

## Install

```bash
pi install git:github.com/spoj/pi-tiny-tools
```

Run a local checkout:

```bash
pi -e .
```

## Scope

The extension patches Pi's transcript components and container rendering. One tool-row patch covers built-in, extension, and MCP tools. Custom messages use their `customType` as the colored name, including after session reload.

This uses private component state (tool data, custom-message data, and assistant message data) and may need an update when Pi changes those components.

The extension changes display only. Tool results and custom-message content sent to the model remain complete.

## Credit

Inspired by [Traceline](https://github.com/tmustier/pine-of-glass/tree/main/extensions/pi-traceline), created by [tmustier](https://github.com/tmustier), which pioneered compact one-line tool traces and synchronized thinking/tool expansion for Pi.
