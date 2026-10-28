import { expect, it } from "vitest";
import { parseGitStatus } from "./git-status";

it("preserves leading status columns and paths containing spaces and handles renames", () => {
  expect(parseGitStatus(" M src/file name.ts\0R  new.ts\0old.ts\0?? new file.txt\0")).toEqual([
    { status: "M", path: "src/file name.ts" },
    { status: "R", path: "new.ts" },
    { status: "??", path: "new file.txt" },
  ]);
});
