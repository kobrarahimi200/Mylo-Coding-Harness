const IPC_PREFIX = /^(?:Error invoking remote method '[^']+':\s*)?(?:Error:\s*)?/;

/** Turns an Electron IPC rejection into a message a user can act on. */
export function fileErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(IPC_PREFIX, "").trim();
  const missing = /^ENOENT: no such file or directory, \w+ '(.+)'$/.exec(message);
  if (missing) return `File not found: ${missing[1]}. It may have been moved or deleted.`;
  return message || "The file could not be read.";
}

export function isMissingFileError(error: unknown): boolean {
  return fileErrorMessage(error).startsWith("File not found:");
}
