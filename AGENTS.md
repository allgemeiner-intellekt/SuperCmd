# Maintaining SuperCmd

This personal fork preserves the owner's daily workflows. Read
[personal-requirements](.agents/skills/personal-requirements/SKILL.md) for upstream
review, feature decisions, development, and fixes. Full Raycast API parity is an
upstream ambition, not a requirement to expand this fork's scope.

## Start here

- For compilation, tests, checks, packaging, or artifacts, follow
  [cloud-build](.agents/skills/cloud-build/SKILL.md). Run them on GitHub where
  possible; use the exact commit when reporting results.
- For source ownership, IPC paths, or choosing where a change belongs, read
  [architecture](docs/architecture.md).
- For extension execution or compatibility changes, read
  [Raycast runtime](docs/raycast-runtime.md).
- For test selection and the limits of current checks, read
  [validation](docs/validation.md).
- Before broader cleanup, consult the
  [maintenance audit](docs/maintenance/2026-11-03-audit.md) for confirmed problems,
  bounded work, and deferred risks.

## Behavior to preserve

- Preserve the app identity, user-data location, settings, preferences,
  credentials, existing extensions, and external service integrations. Treat
  read failures as failures, not evidence that stored data is absent.
- Preserve Chinese IME composition: Enter confirms composition without launching;
  the following Enter launches normally. Candidate navigation and cancellation
  remain owned by the input method.
- Preserve the configured HyperKey source key and tap behavior. Shortcut
  combinations must not insert characters, and ordinary typing must resume.
- Fix compatibility in SuperCmd, not in installed extension source. Keep the
  host React instance shared with extensions.
- Keep no-view commands silent; use the existing status bridge for progress.

## Where changes belong

- Main owns OS operations, persistence, and native process lifetimes. Keep new
  feature logic out of `main.ts` when a focused module can own it; wire IPC there.
- IPC changes must agree across `src/main/main.ts`, `src/main/preload.ts`, and
  `src/renderer/types/electron.d.ts`. Inspect producer, bridge, and consumer.
- `App.tsx` composes hooks and routes views. Put feature state and effects in
  `hooks/`, view rendering in `views/` or `components/`, and pure helpers in
  `utils/`. Keep resource creation and cleanup under one owner.
- Implement Raycast behavior in its focused runtime module; wire public exports
  through `raycast-api/index.tsx`.
- For async work, define who owns cancellation, which completion is still valid,
  and when a cache becomes visible. Test overlapping operations, not only one
  successful request.
- Use a small module interface that hides a real responsibility. Splitting a
  large file into pass-through wrappers does not improve ownership.

## Copy and verification

When adding, renaming, or removing UI copy, update every locale under
`src/renderer/src/i18n/locales/` with the same key paths and interpolation tokens.
Use `en.json` as the key source; translate each locale rather than copying another
language wholesale. Read [i18n architecture](docs/i18n-architecture.md) for the
runtime and fallback behavior.

Prefer tests through the production interface. A source-text assertion proves
wiring, not runtime behavior. Report skipped tests and separate build evidence
from macOS permission, physical keyboard, and real-extension acceptance.

Keep each PR focused, describe the behavior change and evidence, and record
remaining limitations. Update the relevant architecture or runtime reference
when moving ownership or changing a contract. `AGENTS.md` is the shared agent
entry point; `CLAUDE.md` points here instead of duplicating these rules.
