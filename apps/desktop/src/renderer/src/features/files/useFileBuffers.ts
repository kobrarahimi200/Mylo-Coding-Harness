import { useCallback, useEffect, useState } from "react";
import type { FileReadResult } from "../../../../shared/contracts";
import { type FileBuffer, fileBuffer } from "./file-buffers";

type BufferState = { active: string | undefined; buffers: Record<string, FileBuffer> };
const retainedBuffers = new Map<string, BufferState>();
export function useFileBuffers(cacheId?: string) {
  const [state, setState] = useState<{
    active: string | undefined;
    buffers: Record<string, FileBuffer>;
  }>(() =>
    cacheId
      ? (retainedBuffers.get(cacheId) ?? { active: undefined, buffers: {} })
      : { active: undefined, buffers: {} },
  );
  useEffect(() => {
    if (cacheId) retainedBuffers.set(cacheId, state);
  }, [cacheId, state]);
  const setSelectedFile = useCallback(
    (file: FileReadResult | undefined) =>
      setState((current) =>
        file
          ? {
              active: file.path,
              buffers: {
                ...current.buffers,
                [file.path]: current.buffers[file.path]
                  ? ({ ...current.buffers[file.path], file } as FileBuffer)
                  : fileBuffer(file),
              },
            }
          : { ...current, active: undefined },
      ),
    [],
  );
  const update = useCallback(
    (key: "saved" | "draft", value: string | undefined) =>
      setState((current) => {
        const buffer = current.active ? current.buffers[current.active] : undefined;
        if (!buffer || !current.active) return current;
        return {
          ...current,
          buffers: { ...current.buffers, [current.active]: { ...buffer, [key]: value } },
        };
      }),
    [],
  );
  const setSavedContent = useCallback(
    (value: string | undefined) => update("saved", value),
    [update],
  );
  const setDraftContent = useCallback(
    (value: string | undefined) => update("draft", value),
    [update],
  );
  const close = useCallback(
    (path: string) =>
      setState((current) => {
        const buffers = { ...current.buffers };
        delete buffers[path];
        return {
          buffers,
          active: current.active === path ? Object.keys(buffers).at(-1) : current.active,
        };
      }),
    [],
  );
  const current = state.active ? state.buffers[state.active] : undefined;
  return {
    buffers: state.buffers,
    selectedFile: current?.file,
    savedContent: current?.saved,
    draftContent: current?.draft,
    setSelectedFile,
    setSavedContent,
    setDraftContent,
    close,
  };
}
