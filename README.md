# pi-tiny-tools

A small [Pi](https://github.com/earendil-works/pi-mono) extension that reduces Pi's internal activity—tool calls, thinking, and extension messages—to colored names.

```text
 › think read bash pi-subagents think edit write
```

The default transcript is quiet:

- User and assistant messages render normally.
- Tool activity, thinking, and custom messages render only as compact trace names.
- Other persisted internal entries, including user-shell output, custom entries, compaction summaries, and branch summaries, are hidden.
- Model and thinking-level changes remain silent.

Internal names share one layout and flow onto indented continuation lines when needed. Thinking uses Pi's native thinking color. Compact traces have one leading blank line and no blank rows between items.

Run `/trace` or press `Alt+T` to inspect thinking, calls, results, and visible or hidden custom messages from the current session branch in a Pi overlay. It opens on the newest item and follows the current thinking trace while it streams. Pi's native `Ctrl+T` and `Ctrl+O` toggles remain available; their display effects are intentionally invisible while the compact trace renderer is active.

- `j` / `k`: next / previous item
- `PageDown` / `PageUp` or `Ctrl+D` / `Ctrl+U`: scroll the current item
- `g` / `G`: top / bottom
- `Esc`: close

The inspector shows the complete data retained in the session. It cannot recover output that a tool discarded before returning; when a tool truncates output, its stored result and truncation details are shown.

## Install

```bash
pi install git:github.com/spoj/pi-tiny-tools
```

Run a local checkout:

```bash
pi -e .
```

## Scope

The extension patches Pi's `ToolExecutionComponent`, `CustomMessageComponent`, and `AssistantMessageComponent` rendering. One tool-row patch covers built-in, extension, and MCP tools. Custom messages use their `customType` as the colored name, including after session reload.

This uses private component state (tool data, custom-message data, and assistant message data) and may need an update when Pi changes those components.

The extension changes display only. Tool results and custom-message content sent to the model remain complete.

## Credit

Inspired by [Traceline](https://github.com/tmustier/pine-of-glass/tree/main/extensions/pi-traceline), created by [tmustier](https://github.com/tmustier), which pioneered compact one-line tool traces and synchronized thinking/tool expansion for Pi.
