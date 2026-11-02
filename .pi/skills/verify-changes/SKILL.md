---
name: verify-changes
description: "Verify code changes in the Mylo/Modus repo: run typecheck, lint, and the relevant vitest files. Use after editing apps/desktop source."
---

# Verify changes

Run from `apps/desktop` unless noted.

1. Typecheck: `npm run typecheck` (must report no `error TS`).
2. Format and lint the touched paths: `npx biome check --write --diagnostic-level=error <paths>`.
3. Run only the affected tests: `npm exec -- vitest run --root ../.. apps/desktop/src/<path>`.
4. Before finishing, run the whole suite from the repo root: `npm run test`.

Notes:
- `exactOptionalPropertyTypes` is on: pass `false`, not `undefined`, to optional props.
- Report only results you actually ran. `.vscode/tasks.json` and `theme.css` have pre-existing biome format errors; do not reformat them as part of unrelated work.
