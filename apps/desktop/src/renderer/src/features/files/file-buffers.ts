import type { FileReadResult } from "../../../../shared/contracts";
export type FileBuffer = {
  file: FileReadResult;
  saved: string | undefined;
  draft: string | undefined;
};
export function fileBuffer(file: FileReadResult): FileBuffer {
  const text = file.binary || file.truncated ? undefined : file.content;
  return { file, saved: text, draft: text };
}
export function isDirty(buffer: FileBuffer): boolean {
  return buffer.draft !== undefined && buffer.draft !== buffer.saved;
}
export function canReloadBuffer(buffer: FileBuffer, disk: string | undefined): boolean {
  return !isDirty(buffer) || disk === buffer.saved;
}
