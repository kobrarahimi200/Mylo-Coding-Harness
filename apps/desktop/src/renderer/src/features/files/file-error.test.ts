import { describe, expect, it } from "vitest";
import { fileErrorMessage, isMissingFileError } from "./file-error";

describe("fileErrorMessage", () => {
  it("rewrites the raw Electron ENOENT rejection", () => {
    const error = new Error(
      "Error invoking remote method 'files:read': Error: ENOENT: no such file or directory, stat '/Users/me/deployment-agent/proof.js'",
    );
    expect(fileErrorMessage(error)).toBe(
      "File not found: /Users/me/deployment-agent/proof.js. It may have been moved or deleted.",
    );
    expect(isMissingFileError(error)).toBe(true);
  });

  it("keeps the main-process missing-file message", () => {
    const error = new Error(
      "Error invoking remote method 'files:read': Error: File not found: proof.js. It may have been moved or deleted.",
    );
    expect(fileErrorMessage(error)).toBe(
      "File not found: proof.js. It may have been moved or deleted.",
    );
    expect(isMissingFileError(error)).toBe(true);
  });

  it("strips the IPC wrapper from other errors without hiding them", () => {
    const error = new Error("Error invoking remote method 'files:read': Error: Path is outside.");
    expect(fileErrorMessage(error)).toBe("Path is outside.");
    expect(isMissingFileError(error)).toBe(false);
  });

  it("handles non-Error values and empty messages", () => {
    expect(fileErrorMessage("boom")).toBe("boom");
    expect(fileErrorMessage(new Error(""))).toBe("The file could not be read.");
    expect(isMissingFileError(undefined)).toBe(false);
  });
});
