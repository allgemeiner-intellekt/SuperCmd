# Validation evidence

Follow the [cloud build skill](../.agents/skills/cloud-build/SKILL.md) to run
checks on GitHub and associate results with the intended commit. Editing and
reading source do not require a local build. Use `package.json` and
`.github/workflows/personal-build.yml` for the actual commands and runner.

## What each check proves

The workflow runs portable tests and both TypeScript/Vite builds on Linux for
feedback independent of macOS runner capacity. That job installs dependencies
without lifecycle scripts and does not launch Electron or build native helpers.
It uses `npm ci --force` to retain the locked Darwin-only `electron-liquid-glass`
dependency on Linux; dependency platform compatibility is checked by the ordinary
macOS installation, not this portable job.
macOS-only cases self-skip there. The separate arm64 job still runs the full test
suite and remains required for platform evidence; portable success is not macOS
acceptance or a promise of Linux application support.

| Check | Evidence | Limit |
| --- | --- | --- |
| `npm test` | Runs `scripts/test-*.mjs` with Node's test runner | Inspect individual tests and skips; some older tests only assert source text |
| `npm run build:main` | TypeScript checking and emission for main/shared code | Does not type-check renderer code |
| `npm run build:renderer` | Vite can bundle the renderer | Transpilation is not TypeScript type checking |
| `npm run check:renderer-types` | Full diagnostics from `tsconfig.renderer.json` | Initially reported separately from blocking checks while existing debt is assessed |
| `npm run check:i18n` | Locale key and value-shape comparison | Only configured strict locales fail the job; translation quality and interpolation correctness need review |
| Installer workflow | Native compilation, packaging, identity/signature and artifact checks | Checks-only runs produce no installer; packaging does not grant macOS permissions |

Both jobs upload renderer type diagnostics and label their result. An
otherwise green build is not proof that renderer types are clean. Keep existing
diagnostics visible; resolve the debt before making that check blocking.

The owner does not use the Claude GitHub App. Its inherited automatic-review and
`@claude` comment workflows are removed; the repository-level workflows are also
disabled so older branches cannot trigger them. Historical authentication failures
remain visible but do not represent completed code reviews. Record reviews from
the owner's chosen tools separately from test and build results.

## Choosing tests

Exercise production modules through the same interface as callers. For an async
race, control completion order with deferred promises. For a scheduler, inject
time and assert due times, execution counts, overlap, and disposal. For storage
or installation, use a temporary directory and inject write/rename failures;
check both the return value and the durable files after retry.

Keep OS adapters thin so the behavior can be tested without launching the whole
app. Add a real macOS integration case where the adapter itself is the risk,
such as subprocess stdin, timeout, and exit behavior. Source-string assertions
may cover wiring but cannot replace these tests.

Existing tests cover IME sequences, root ranking, renderer recovery, HyperKey
event handling and packaging, updater opt-out, and artifact provenance. Read
the relevant `scripts/test-*.mjs` before extending them. The live Electron
recovery test self-skips when Electron cannot launch; a skip is not a pass.

## Performance evidence

Use counts or bounded-state assertions for eliminated work: discovery calls,
icon IPC calls, timer allocations, simultaneous executions, or retained cache
entries. Use a real event-loop heartbeat for blocking subprocess work. Do not
translate those results into a startup-time or memory percentage without a
measured baseline, workload, machine, and repeatable measurement procedure.

## Before handing off a PR

Record the head SHA and the matching GitHub run URL, the behavior covered, any
skips, and any remaining diagnostics. PR workflows may test a merge commit;
distinguish that SHA from the branch head. Use a checks-only manual dispatch
with the expected SHA when exact branch-head evidence is needed.

Physical Chinese IME candidate handling, HyperKey interaction with focused apps,
macOS privacy/Keychain consent, real extension provider authorization, and voice
models require appropriate device acceptance. Preserve known behavior and state
which of those paths was actually exercised. Never clear credentials or change
app identity to make a test pass.
