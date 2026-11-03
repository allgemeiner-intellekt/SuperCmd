---
name: cloud-build
description: Compile, test, check, package, or retrieve GitHub build artifacts for the personal SuperCmd fork.
---

# Cloud build

Run compilation, tests, checks, and packaging on GitHub where possible to avoid consuming local resources. Editing, commits, and pushes use the normal development workflow.

## Entry points

- Repository: `allgemeiner-intellekt/SuperCmd`; upstream: `SuperCmdLabs/SuperCmd`.
- Workflow: [personal-build.yml](../../../.github/workflows/personal-build.yml). Manual dispatch controls whether to package an installer or run checks only. Pushes to `main` and pull requests run checks for the paths listed there.
- Build and packaging commands, runner selection, and retention are authoritative in the workflow and `package.json`.
- Artifact operations: [personal-build.mjs](../../../scripts/personal-build.mjs); use its `--help` for dispatch, status, and download usage. The helper checks the repository, selected commit, run result, and artifact provenance.

## Use a specific commit

Commit and push the intended changes to the fork. Dispatch the workflow for that branch or tag using `--commit <full-sha>` to check it matches the selected source. If the ref has advanced, use a branch or tag pointing to the requested commit rather than substituting a newer tip. Record the selected SHA and run URL. A workflow on a new branch becomes manually dispatchable after its workflow file exists on the default branch.

Inspect the run associated with that exact SHA. A successful checks-only run is not an installer build. Download the installer artifact from a successful packaging run, then check its manifest and SHA-256 checksums. A similarly named artifact from another commit is not a substitute.

The Actions page is the distribution entry point. Packages target macOS arm64, are unsigned and unnotarized, retain the existing application identity/data directory, and use manual updates. Gatekeeper may require the owner's explicit approval; macOS permissions may need to be granted again after replacement. Installing or replacing the running application is a separate task.

Use [Personal macOS Build](https://github.com/allgemeiner-intellekt/SuperCmd/actions/workflows/personal-build.yml) → **Run workflow** to request an installer in the browser. Download the `supercmd-macos-arm64-<commit>` artifact from the successful run. Retention is finite; preserve a verified installer separately if it must outlive the configured retention window.

`package.json` opts out of in-app updates through `supercmd.updatesEnabled`; `ensureAppUpdaterConfigured` checks this before loading the updater. Publishing is also disabled. Keep these controls when changing packaging; `--publish never` alone does not disable runtime update checks.

## Verification status

Configured and enabled on the fork's default branch. Both skills pass the skill validator and their file references resolve; the workflow passes actionlint. The helper's status lookup and rejection of a mismatched selected commit were checked against the fork.

[GitHub checks](https://github.com/allgemeiner-intellekt/SuperCmd/actions/runs/41617534187) passed for `dfb42008cd3a2edaf426bfb70ab81e33f274e143`: clean dependency installation, 31 tests with no failures or skips, main-process compilation, and renderer build. Tests exercise updater opt-out and artifact provenance/checksum verification. The translation checker exited successfully but reports two pre-existing Italian missing keys, `settings.ai.whisper.vocabulary` and `settings.extensions.appSearchScope`.

This was a checks-only push run. Full native compilation, DMG packaging, a successful manual dispatch, real installer artifact download, and installation remain unverified. Documentation-only updates after that revision retain the above code/workflow evidence. Run an installer build when artifacts are first needed; successful checks alone do not establish packaged-app behavior.
