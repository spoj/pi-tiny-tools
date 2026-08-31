# pi-tiny-tools

A small [Pi](https://github.com/earendil-works/pi-mono) extension that replaces boxed tool output and extension messages with compact one-line rows.

```text
  › read src/index.ts:1-120                         4.2k ch
  › $ npm test                                      1.8k ch
  › [pi-subagents] Subagent completed · Result: done  0.2k ch
```

Press `Ctrl+O` to switch between the compact rows and Pi's complete native rendering. Showing or hiding thinking with `Ctrl+T` expands or collapses tools with it. Normal user and assistant messages are not changed.

## Install

```bash
pi install git:github.com/spoj/pi-tiny-tools
```

Run a local checkout:

```bash
pi -e .
```

## Scope

The extension patches Pi's `ToolExecutionComponent` and `CustomMessageComponent` render methods. One tool-row patch covers built-in, extension, and MCP tools. Custom messages remain identifiable by `customType`, including after session reload.

This uses private component state (`expanded`, tool data, and custom-message data) and may need an update when Pi changes those components. Compact-rendering failures fall back to Pi's native renderer.

The extension changes display only. Tool results and custom-message content sent to the model remain complete.

## Credit

Inspired by [Traceline](https://github.com/tmustier/pine-of-glass/tree/main/extensions/pi-traceline), created by [tmustier](https://github.com/tmustier), which pioneered compact one-line tool traces and synchronized thinking/tool expansion for Pi.
