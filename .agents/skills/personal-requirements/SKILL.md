---
name: personal-requirements
description: Assess upstream changes, feature proposals, development, and fixes against the owner's personal SuperCmd requirements.
---

# Personal requirements

Confirmed with the owner on 2026-11-03.

## Maintenance baseline

This fork, `allgemeiner-intellekt/SuperCmd`, supports the owner's established daily use. Upstream is `SuperCmdLabs/SuperCmd`; its reduced activity motivates independent maintenance, rather than a new product roadmap.

- Preserve the existing application's behavior, configuration, and established workflows. Prioritize stability and fixes needed in actual use.
- Review upstream commits and community PRs before adopting them. Assess security, dependency, performance, and compatibility changes for their underlying effects, even when their feature names appear unrelated.
- Introduce features when needed. Full Raycast API parity is an upstream aspiration, not a requirement to implement every API in this personal fork. Preserve compatibility for existing extensions when changing the runtime.
- Specific daily features and extension names have not been enumerated. Keep that uncertainty explicit; an unmentioned feature is not permission to remove or break it. Ask for a concrete workflow when a proposed trade-off needs one.

## Confirmed choices

- Support Apple Silicon Macs only at this stage; Intel support is outside the current build scope.
- Produce installation packages for the owner, using manually triggered GitHub builds and manual downloads. The owner has no Apple Developer signing identity and does not need automatic updates.
- Retain the `SuperCmd` name, `com.supercmd.app` identity, and existing user-data location. Preserve settings, extension preferences, credentials, and other existing data when making changes.
- Application identity and data separation may be reconsidered later. That is a future possibility, not a current migration task.

External extension, Canvas, and other service dependencies remain part of the existing behavior until a specific need justifies replacing them. Upstream inactivity alone does not authorize disabling these features.

For compilation, checks, packaging, and artifact retrieval, use [cloud-build](../cloud-build/SKILL.md).
