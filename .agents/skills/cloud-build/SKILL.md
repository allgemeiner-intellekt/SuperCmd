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

The Actions page is the distribution entry point. Packages target macOS arm64, use an ad-hoc signature without a Developer ID certificate or notarization, retain the existing application identity/data directory, and use manual updates. Gatekeeper may require the owner's explicit approval; macOS permissions may need to be granted again after replacement. Installing or replacing the running application is a separate task.

The `afterPack` hook [sign-macos.cjs](../../../scripts/sign-macos.cjs) seals the complete app with the existing entitlements. `mac.identity: null` skips certificate signing; alone it leaves Electron's linker-only signature and can prevent TCC from recognizing the app as SuperCmd. Keep the hook and the workflow's strict signature/identity check together. Ad-hoc signing binds the bundle; the owner still grants macOS permissions through system UI.

Use [Personal macOS Build](https://github.com/allgemeiner-intellekt/SuperCmd/actions/workflows/personal-build.yml) → **Run workflow** to request an installer in the browser. Download the `supercmd-macos-arm64-<commit>` artifact from the successful run. Retention is finite; preserve a verified installer separately if it must outlive the configured retention window.

`package.json` opts out of in-app updates through `supercmd.updatesEnabled`; `ensureAppUpdaterConfigured` checks this before loading the updater. Publishing is also disabled. Keep these controls when changing packaging; `--publish never` alone does not disable runtime update checks.

## Verification status

Configured and enabled on the fork's default branch. Both skills pass the skill validator and their file references resolve; the workflow passes actionlint. The helper's status lookup and rejection of a mismatched selected commit were checked against the fork.

The previous 1.0.27 run verified compilation, 44 tests, DMG creation, and artifact retrieval, but local diagnosis subsequently found an invalid linker-only bundle signature. It is not evidence for usable macOS permission attribution. The new signing hook passed strict verification on an isolated copy, producing `Identifier=com.supercmd.app`, a bound Info.plist, sealed resources, and hardened runtime. A fresh cloud installer build with the signing hook and CI verification is pending.

The translation checker exited successfully but still reports two pre-existing Italian missing keys, `settings.ai.whisper.vocabulary` and `settings.extensions.appSearchScope`.

Local 1.0.27 launch and its updater opt-out were observed, but Accessibility access failed despite an enabled System Settings entry, with repeated snippet-helper requests. Its process was stopped during repair; existing application and full user-data backups remain available. The repaired installer still needs download, installation, and live permission/input validation. Preserve existing encrypted storage rather than clearing it to bypass authorization.
