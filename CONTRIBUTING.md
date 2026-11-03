# Contributing to this SuperCmd fork

This fork maintains the owner's existing workflows. Read the
[personal requirements](.agents/skills/personal-requirements/SKILL.md) before
proposing product changes, and [AGENTS.md](AGENTS.md) for working rules.
Upstream feature parity is not the acceptance criterion for this fork.

## Find the owner of a change

The [architecture map](docs/architecture.md) follows the actual source layout.
Use the [Raycast runtime map](docs/raycast-runtime.md) for extension work and the
[maintenance audit](docs/maintenance/2026-11-03-audit.md) for known defects and
follow-up scope. Historical development notes are not verification evidence.

Keep a PR focused on one behavior or responsibility. Make the smallest interface
that owns the behavior, its async lifetime, and its failure handling. Preserve
existing command IDs, stored data, extension contracts, IME, and HyperKey.

## Validate on the intended commit

Follow [cloud-build](.agents/skills/cloud-build/SKILL.md) for GitHub checks and
installer builds. See [validation](docs/validation.md) for what each check covers
and what still requires macOS or real-extension acceptance. The authoritative
commands live in `package.json`; no local build is required just to begin work.

For a bug, add a behavior regression through the production interface. Explain
the trigger, the previous result, and the corrected result. For performance,
record the workload and measured evidence or deterministic work counts. Avoid
unmeasured speedup claims.

## Submit a PR

Target `main` in `allgemeiner-intellekt/SuperCmd`. Include:

- The concrete behavior change and compatibility impact.
- The exact head SHA and matching GitHub run evidence.
- Regression cases exercised and any skipped or device-only checks.
- Remaining risks, including data migration or rollback implications.

Use a descriptive branch and commit message. Update ownership references when
moving a module. UI string changes update every locale key and interpolation
placeholder in the same PR. Extension compatibility changes belong in SuperCmd,
not in an installed extension's source.

## Report a bug

Include the SuperCmd version, macOS version and architecture, reproduction steps,
expected and actual results, and relevant redacted logs. For extension failures,
include the extension and command names. Keep credentials and personal content
out of logs and screenshots.
