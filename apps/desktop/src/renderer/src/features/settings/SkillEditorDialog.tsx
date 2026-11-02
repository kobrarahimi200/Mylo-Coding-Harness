import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import type { SkillDraft } from "../../../../shared/contracts";
import { Button } from "../../components/ui/Button";
import { DialogBody, DialogSurface } from "../../components/ui/DialogSurface";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function skillNameError(name: string): string | undefined {
  if (!name) return undefined;
  if (name.length > 64) return "Use 64 characters or fewer.";
  if (!NAME_PATTERN.test(name))
    return "Use lowercase letters, numbers, and single hyphens, like code-review.";
  return undefined;
}

function previewFile({ name, description, instructions }: SkillDraft): string {
  const summary = description.replace(/\s+/g, " ").trim();
  return `---\nname: ${name || "skill-name"}\ndescription: ${JSON.stringify(summary || "When to use this skill")}\n---\n\n${instructions.trim() || "# Instructions"}`;
}

export function SkillEditorDialog({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: SkillDraft;
  onClose(): void;
  onSubmit(draft: SkillDraft): Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nameError = mode === "create" ? skillNameError(draft.name) : undefined;
  const ready =
    Boolean(draft.name && draft.description.trim() && draft.instructions.trim()) && !nameError;
  const update = (patch: Partial<SkillDraft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogSurface className="skill-editor-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || busy) return;
            setBusy(true);
            setError(undefined);
            onSubmit(draft).catch((cause: unknown) => {
              setBusy(false);
              setError(cause instanceof Error ? cause.message : String(cause));
            });
          }}
        >
          <header className="shrink-0 px-6 pt-6 pb-3">
            <p className="mylo-popup-pill">{mode === "create" ? "New skill" : "Edit skill"}</p>
            <Dialog.Title className="mt-3 font-semibold text-fg text-lg leading-snug">
              {mode === "create" ? "Teach the agent something new" : draft.name}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-fg-muted text-sm">
              Saved as a SKILL.md file: a name, a short description, then Markdown instructions.
            </Dialog.Description>
          </header>
          <DialogBody className="grid content-start gap-4 px-6 pb-4">
            {mode === "create" ? (
              <label className="grid gap-1.5">
                <span className="text-fg-muted text-xs">Name</span>
                <input
                  className="field-control h-10 font-mono"
                  maxLength={64}
                  onChange={(event) => update({ name: event.target.value.trim() })}
                  placeholder="code-review"
                  value={draft.name}
                />
                <span className={nameError ? "text-danger text-xs" : "text-fg-faint text-xs"}>
                  {nameError ??
                    "Becomes the folder name and the /command you type in the composer."}
                </span>
              </label>
            ) : null}
            <label className="grid gap-1.5">
              <span className="text-fg-muted text-xs">Description</span>
              <textarea
                className="field-control min-h-16 resize-none py-2"
                maxLength={1024}
                onChange={(event) => update({ description: event.target.value })}
                placeholder="Review code changes for bugs. Use when asked to review a diff."
                value={draft.description}
              />
              <span className="text-fg-faint text-xs">
                Tell the agent what this does and when to use it.
              </span>
            </label>
            <label className="grid gap-1.5">
              <span className="text-fg-muted text-xs">Instructions</span>
              <textarea
                className="field-control min-h-40 py-2 font-mono text-xs leading-5"
                onChange={(event) => update({ instructions: event.target.value })}
                placeholder={"# Steps\n1. Read the changed files\n2. Report issues by severity"}
                value={draft.instructions}
              />
            </label>
            <details className="mylo-skill-preview">
              <summary>Preview SKILL.md</summary>
              <pre>{previewFile(draft)}</pre>
            </details>
            {error ? (
              <p role="alert" className="break-words text-danger text-sm">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <footer className="flex shrink-0 justify-end gap-2 bg-panel px-6 py-3">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy ? "Saving..." : mode === "create" ? "Create skill" : "Save changes"}
            </Button>
          </footer>
        </form>
      </DialogSurface>
    </Dialog.Root>
  );
}

export function ConfirmDeleteDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel(): void;
  onConfirm(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogSurface size="compact" className="skill-confirm-dialog">
        <header className="px-6 pt-6 pb-2">
          <p className="mylo-popup-pill mylo-popup-pill-danger">Delete skill</p>
          <Dialog.Title className="mt-3 font-semibold text-fg text-lg leading-snug">
            Delete "{name}"?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-fg-muted text-sm">
            This removes the skill folder from your computer. It can't be undone.
          </Dialog.Description>
        </header>
        <div className="min-h-0 flex-1 px-6">
          {error ? (
            <p role="alert" className="break-words text-danger text-sm">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 bg-panel px-6 py-3">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm().catch((cause: unknown) => {
                setBusy(false);
                setError(cause instanceof Error ? cause.message : String(cause));
              });
            }}
          >
            {busy ? "Deleting..." : "Delete"}
          </Button>
        </footer>
      </DialogSurface>
    </Dialog.Root>
  );
}
