import { IconEdit, IconFolder, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { SkillDraft, SkillInfo, SkillState } from "../../../../shared/contracts";
import { Button } from "../../components/ui/Button";
import { ResourceRow } from "../../components/ui/ResourceRow";
import { SearchField } from "../../components/ui/SearchField";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";
import { ConfirmDeleteDialog, SkillEditorDialog } from "./SkillEditorDialog";

type Editor = { mode: "create" } | { mode: "edit"; path: string; draft: SkillDraft };

export function SkillsSettingsPanel({
  cwd,
  sessionId,
  busy = false,
}: {
  cwd: string | undefined;
  sessionId: string | undefined;
  busy?: boolean;
}) {
  const [state, setState] = useState<SkillState>({ skills: [], diagnostics: [] });
  const [folders, setFolders] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [editor, setEditor] = useState<Editor>();
  const [deleting, setDeleting] = useState<SkillInfo>();
  useEffect(() => {
    let active = true;
    let request = 0;
    setState({ skills: [], diagnostics: [] });
    setError(undefined);
    if (!sessionId) return;
    const load = () => {
      void window.modus.skills
        .folders(sessionId)
        .then((paths) => {
          if (active) setFolders(paths);
        })
        .catch((cause: unknown) => setError(String(cause)));
      const current = ++request;
      setLoading(true);
      void window.modus.skills
        .list(sessionId)
        .then((result) => {
          if (active && request === current) {
            setState(result);
            setError(undefined);
          }
        })
        .catch((cause: unknown) => {
          if (active && request === current) setError(String(cause));
        })
        .finally(() => {
          if (active && request === current) setLoading(false);
        });
    };
    load();
    const unsubscribe = window.modus.skills.onChanged((path) => {
      if (path === cwd) load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [cwd, sessionId]);
  const filtered = [...state.skills, ...(state.disabledSkills ?? [])].filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="min-w-0 space-y-5">
      <SettingsPageHeader title="Skills" />
      <p className="text-sm text-fg-muted">
        Skills are reusable instructions for the agent. Create your own, or add a folder of trusted
        skills.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={!sessionId || loading || busy}
          onClick={() => setEditor({ mode: "create" })}
        >
          <IconPlus aria-hidden size={15} stroke={2} />
          New skill
        </Button>
        <Button
          disabled={!sessionId || loading || busy}
          onClick={() => {
            if (sessionId)
              void window.modus.skills
                .addFolder(sessionId)
                .then(async (next) => {
                  setState(next);
                  setFolders(await window.modus.skills.folders(sessionId));
                })
                .catch((cause: unknown) => setError(String(cause)));
          }}
        >
          Add skill folder
        </Button>
        <Button
          variant="ghost"
          disabled={!sessionId || loading || busy}
          title={
            busy
              ? "Stop the current task before refreshing skills"
              : "Reload trusted Pi resources and refresh discovered skills"
          }
          onClick={() => {
            if (!sessionId) return;
            setLoading(true);
            void window.modus.app
              .reloadConfiguration()
              .then(() => window.modus.skills.list(sessionId))
              .then(setState)
              .catch((cause: unknown) => setError(String(cause)))
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </Button>
      </div>
      {busy ? (
        <p className="text-xs text-fg-faint">Stop the agent before changing its skills.</p>
      ) : null}
      {folders.map((path) => (
        <div
          className="flex items-center justify-between gap-3 rounded-lg bg-accent-soft px-3 py-2 text-sm"
          key={path}
        >
          <span className="break-all text-fg-muted">{path}</span>
          <Button
            variant="ghost"
            disabled={!sessionId || busy}
            onClick={() => {
              if (sessionId)
                void window.modus.skills
                  .removeFolder({ sessionId, path })
                  .then(async (next) => {
                    setState(next);
                    setFolders(await window.modus.skills.folders(sessionId));
                  })
                  .catch((cause: unknown) => setError(String(cause)));
            }}
          >
            Remove
          </Button>
        </div>
      ))}
      <SearchField
        ariaLabel="Search skills"
        onChange={setQuery}
        placeholder="Search skills"
        value={query}
      />
      {error ? (
        <p role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {state.diagnostics.map((diagnostic) => (
        <p
          role="status"
          key={`${diagnostic.path}:${diagnostic.message}`}
          className="break-words text-xs text-fg-muted"
        >
          {diagnostic.message}
          {diagnostic.path ? ` (${diagnostic.path})` : ""}
        </p>
      ))}
      {!sessionId ? (
        <p className="text-sm text-fg-muted">
          Open or start a chat in a project to create skills or add skill folders.
        </p>
      ) : loading ? (
        <p role="status" className="text-sm text-fg-muted">
          Loading skills...
        </p>
      ) : !error && !filtered.length ? (
        <p className="text-sm text-fg-muted">
          {state.skills.length
            ? "No skills match your search."
            : "No skills loaded for this session."}
        </p>
      ) : null}
      <div className="space-y-1">
        {filtered.map((skill) => (
          <div key={skill.path} className="mylo-skill-card">
            <input
              type="checkbox"
              aria-label={`Enable ${skill.name}`}
              checked={skill.enabled !== false}
              disabled={busy || loading}
              onChange={(event) => {
                if (sessionId)
                  void window.modus.skills
                    .setEnabled({ sessionId, path: skill.path, enabled: event.target.checked })
                    .then(setState)
                    .catch((cause: unknown) => setError(String(cause)));
              }}
            />
            <ResourceRow
              action={{
                icon: <IconFolder aria-hidden size={16} stroke={1.8} />,
                label: `Open ${skill.name} folder`,
                onClick: () => {
                  if (sessionId)
                    void window.modus.skills
                      .openDir({ sessionId, path: skill.path })
                      .catch((cause: unknown) => setError(String(cause)));
                },
              }}
              description={skill.description}
              key={skill.path}
              meta={skill.path}
              title={skill.name}
            />
            {skill.editable ? (
              <div className="mylo-skill-actions">
                <Button
                  variant="ghost"
                  disabled={busy || loading}
                  onClick={() => {
                    if (!sessionId) return;
                    void window.modus.skills
                      .read({ sessionId, path: skill.path })
                      .then((draft) => setEditor({ mode: "edit", path: skill.path, draft }))
                      .catch((cause: unknown) => setError(String(cause)));
                  }}
                >
                  <IconEdit aria-hidden size={15} stroke={1.8} />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  className="hover:text-danger"
                  disabled={busy || loading}
                  onClick={() => setDeleting(skill)}
                >
                  <IconTrash aria-hidden size={15} stroke={1.8} />
                  Delete
                </Button>
              </div>
            ) : null}
            <details className="mylo-skill-details">
              <summary>Details</summary>
              <p>{skill.description}</p>
              <dl>
                <dt>Source</dt>
                <dd>
                  {skill.source} · {skill.scope}
                </dd>
                <dt>File</dt>
                <dd>{skill.path}</dd>
                <dt>Status</dt>
                <dd>{skill.enabled === false ? "Disabled" : "Enabled"}</dd>
              </dl>
            </details>
          </div>
        ))}
      </div>
      {editor && sessionId ? (
        <SkillEditorDialog
          mode={editor.mode}
          initial={
            editor.mode === "edit" ? editor.draft : { name: "", description: "", instructions: "" }
          }
          onClose={() => setEditor(undefined)}
          onSubmit={async (draft) => {
            const next =
              editor.mode === "create"
                ? await window.modus.skills.create({ sessionId, ...draft })
                : await window.modus.skills.update({
                    sessionId,
                    path: editor.path,
                    description: draft.description,
                    instructions: draft.instructions,
                  });
            setState(next);
            setError(undefined);
            setEditor(undefined);
          }}
        />
      ) : null}
      {deleting && sessionId ? (
        <ConfirmDeleteDialog
          name={deleting.name}
          onCancel={() => setDeleting(undefined)}
          onConfirm={async () => {
            setState(await window.modus.skills.delete({ sessionId, path: deleting.path }));
            setDeleting(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
