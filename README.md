# pi-tiny-tools

A small [Pi](https://github.com/earendil-works/pi-mono) extension that replaces boxed tool output and extension messages with colored names.

```text
  › read bash edit write Fork
    ForkSteer pi-subagents read
```

Tool and extension names share the same layout and flow onto indented continuation lines when needed. `Ctrl+T` switches between visible thinking with Pi's native tool rendering and hidden thinking with compact tool names. `Ctrl+O` retains Pi's normal collapsed/full tool-output toggle; while the compact view is active it updates the underlying native view without changing what is visible. Compact traces have one leading blank line and no blank rows between calls. Hidden thinking leaves no placeholder. Normal user and assistant messages are not changed.

Run `/trace` or press `Ctrl+Shift+I` to inspect calls, results, and visible or hidden custom messages from the current session branch in a Pi overlay. It opens on the newest item.

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

The extension patches Pi's `ToolExecutionComponent` and `CustomMessageComponent` render methods. One tool-row patch covers built-in, extension, and MCP tools. Custom messages use their `customType` as the colored name, including after session reload.

This uses private component state (`expanded`, tool data, and custom-message data) and may need an update when Pi changes those components. Compact-rendering failures fall back to Pi's native renderer.

The extension changes display only. Tool results and custom-message content sent to the model remain complete.

## Credit

Inspired by [Traceline](https://github.com/tmustier/pine-of-glass/tree/main/extensions/pi-traceline), created by [tmustier](https://github.com/tmustier), which pioneered compact one-line tool traces and synchronized thinking/tool expansion for Pi.
