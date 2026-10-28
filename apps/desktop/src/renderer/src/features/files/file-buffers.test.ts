import { expect, it } from "vitest";
import type { FileReadResult } from "../../../../shared/contracts";
import { canReloadBuffer, fileBuffer, isDirty } from "./file-buffers";

it("does not reload over an unsaved user draft when an agent changes the disk", () => {
  const buffer = fileBuffer({
    path: "/project/file.ts",
    relativePath: "file.ts",
    content: "original",
    binary: false,
    truncated: false,
    size: 8,
  } as FileReadResult);
  buffer.draft = "user edit";
  expect(isDirty(buffer)).toBe(true);
  expect(canReloadBuffer(buffer, "agent edit")).toBe(false);
  expect(canReloadBuffer(buffer, "original")).toBe(true);
});
