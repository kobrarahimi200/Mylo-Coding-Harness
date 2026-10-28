import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("../interaction/question-broker", () => ({ requestQuestions: ask }));
vi.mock("./audit-log", () => ({ auditHarnessEvent: vi.fn(async () => {}) }));

import { approveToolCall } from "./approval-policy";

it.each([
  "write",
  "edit",
])("blocks a %s when its target directory is replaced with an escaping symlink during approval", async (toolName) => {
  const root = mkdtempSync(join(tmpdir(), "mylo-approval-race-"));
  const cwd = join(root, "project"),
    outside = join(root, "outside"),
    target = join(cwd, "target");
  mkdirSync(target, { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(target, "file.txt"), "before");
  writeFileSync(join(outside, "file.txt"), "private");
  const emit = vi.fn();
  ask.mockImplementation(async () => {
    rmSync(target, { recursive: true });
    symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir");
    return { skipped: false, answers: [{ custom: "approved" }] };
  });
  try {
    const input =
      toolName === "write"
        ? { path: "target/file.txt", content: "approved" }
        : { path: "target/file.txt", edits: [{ oldText: "before", newText: "approved" }] };
    const result = await approveToolCall(
      { cwd, sessionId: "fixture", emit },
      { type: "tool_call", toolCallId: "raced-file", toolName, input },
    );
    expect(result).toMatchObject({
      block: true,
      terminate: true,
      reason: expect.stringContaining("outside the workspace"),
    });
    expect(readFileSync(join(outside, "file.txt"), "utf8")).toBe("private");
    expect(emit).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
