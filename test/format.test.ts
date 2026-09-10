import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderTraceGroup, stripTerminalSequences } from "../src/format.ts";

test("trace rows show only their names", () => {
  assert.deepEqual(renderTraceGroup([{ name: "read", color: "accent" }], 40), [" › read"]);
  assert.deepEqual(renderTraceGroup([{ name: "pi-subagents", color: "customMessageLabel" }], 40), [" › pi-subagents"]);
});

test("trace groups wrap names together", () => {
  const lines = renderTraceGroup([
    { name: "read", color: "accent" },
    { name: "bash", color: "accent" },
    { name: "think", color: "thinkingText" },
    { name: "pi-subagents", color: "customMessageLabel" },
    { name: "write", color: "accent" },
  ], 24);
  assert.deepEqual(lines, [" › read bash think", "   pi-subagents write"]);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
});

test("trace names strip terminal control sequences before styling", () => {
  const osc52 = "malicious\x1b]52;c;secret\x07";
  const csi = "tool\x1b[2J";
  const lines = renderTraceGroup([
    { name: csi, color: "accent" },
    { name: osc52, color: "customMessageLabel" },
  ], 80);

  assert.deepEqual(lines, [" › tool malicious"]);
  assert.ok(lines.every((line) => !line.includes("\x1b")));
});

test("strips 7-bit and 8-bit terminal strings while preserving ordinary text", () => {
  const text = "before\n\t" + "\x1bc" + "after" + "\x1bPsecret\x1b\\" + "dcs" + "\x1b_secret\x1b\\" + "apc" + "\x9d52;c;secret\x9c" + "osc" + "\x9dunterminated";
  assert.equal(stripTerminalSequences("a\x1bcB"), "aB");
  assert.equal(stripTerminalSequences("a\x1b\nB"), "a\nB");
  assert.equal(stripTerminalSequences("a\x1b🙂B"), "a🙂B");
  assert.equal(stripTerminalSequences("a\x1b[\nBz"), "a\nBz");
  assert.equal(stripTerminalSequences("a\x9b🙂Bz"), "a🙂Bz");
  assert.equal(stripTerminalSequences("a\x07b\rc\bd"), "abcd");
  assert.equal(stripTerminalSequences(text), "before\n\tafterdcsapcosc");

  const lines = renderTraceGroup([
    { name: "reset\x1bc", color: "accent" },
    { name: "dcs\x1bPsecret\x1b\\", color: "customMessageLabel" },
    { name: "apc\x1b_secret\x1b\\", color: "accent" },
    { name: "osc\x9dsecret\x9c", color: "customMessageLabel" },
  ], 80);
  assert.deepEqual(lines, [" › reset dcs apc osc"]);
  assert.ok(lines.every((line) => !line.includes("\x1b") && !line.includes("\x9d")));
});

test("styled trace names align after wrapping", () => {
  const ansiTheme = {
    fg(_color: string, text: string) {
      return `\x1b[33m${text}\x1b[39m`;
    },
  } as unknown as Theme;
  const lines = renderTraceGroup([
    { name: "bash", color: "accent" },
    { name: "bash", color: "accent" },
    { name: "bash", color: "accent" },
  ], 12, ansiTheme);

  assert.deepEqual(lines.map(stripTerminalSequences), [" › bash bash", "   bash"]);
  assert.ok(lines.every((line) => visibleWidth(line) <= 12));
});

test("trace names retain their individual colors and use a dim marker", () => {
  const colors: Array<[string, string]> = [];
  const theme = {
    fg(color: string, text: string) {
      colors.push([color, text]);
      return text;
    },
  } as unknown as Theme;
  renderTraceGroup([
    { name: "pending", color: "accent" },
    { name: "done", color: "success" },
    { name: "failed", color: "error" },
    { name: "think", color: "thinkingText" },
    { name: "extension", color: "customMessageLabel" },
  ], 80, theme);
  assert.ok(colors.some(([color, text]) => color === "dim" && text === "›"));
  assert.ok(colors.some(([color, text]) => color === "accent" && text === "pending"));
  assert.ok(colors.some(([color, text]) => color === "success" && text === "done"));
  assert.ok(colors.some(([color, text]) => color === "error" && text === "failed"));
  assert.ok(colors.some(([color, text]) => color === "thinkingText" && text === "think"));
  assert.ok(colors.some(([color, text]) => color === "customMessageLabel" && text === "extension"));
});
