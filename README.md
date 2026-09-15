# pi-tiny-tools

A small [Pi](https://github.com/earendil-works/pi-mono) extension that shows tool calls, thinking, and extension messages as colored names instead of full blocks.

```text
 › think read bash pi-subagents think edit write
```

Your messages, assistant replies, and assistant errors stay visible as usual.

Thinking, tools, skills, custom messages and entries, `!` and `!!` shell commands, compactions, and branch summaries shrink to names. Their full content is still available in `/trace`. Model changes, thinking-level changes, and billing notices are hidden.

Names wrap onto indented lines when needed. Thinking keeps Pi's usual thinking color.

Run `/trace` or press `Alt+T` to open the full details for the current session branch. It starts at the newest item and follows thinking, tool calls, and output as they stream. Pi's `Ctrl+T` and `Ctrl+O` toggles still work, but won't change how the transcript looks while this extension is active.

- `j` / `k`: next / previous item
- `PageDown` / `PageUp` or `Ctrl+D` / `Ctrl+U`: scroll the current item
- `g` / `G`: top / bottom
- `Esc` / `Alt+T`: close

The inspector shows everything Pi kept. If a tool truncated its output, you'll see the stored result and truncation details, not the discarded output.

## Install

```bash
pi install git:github.com/spoj/pi-tiny-tools
```

Run a local checkout:

```bash
pi -e .
```

## How it works

The extension patches Pi's transcript rendering for built-in, extension, and MCP tools. Custom messages use their `customType` as the colored name, including after session reload.

It relies on Pi's private component state, so Pi updates may break it.

This only changes what you see. Tool results and custom-message content sent to the model are unchanged.

## Credit

Inspired by [Traceline](https://github.com/tmustier/pine-of-glass/tree/main/extensions/pi-traceline) by [tmustier](https://github.com/tmustier), which introduced compact one-line tool traces and synchronized thinking/tool expansion for Pi.
