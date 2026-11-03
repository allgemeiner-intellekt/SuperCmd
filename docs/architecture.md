# Source ownership

Use this map to choose where a change belongs. Paths are relative to the
repository root. The main process is still large; the table describes actual
ownership rather than a proposed directory structure.

## Processes and IPC

The main process starts at `src/main/main.ts`. It owns windows, global shortcuts,
IPC registration, and much of the native process orchestration. A renderer calls
`window.electron`, implemented in `src/main/preload.ts`; its declared contract is
`src/renderer/types/electron.d.ts`. These contracts are maintained separately, so
check all three locations when changing a payload or adding a method.

`src/renderer/src/main.tsx` selects the window's root app by URL hash. It loads the
launcher, settings, extension store, notes, canvas, and prompt roots separately.
Preserve that split when moving imports. The launcher permits real Node built-ins
for extensions; do not assume every renderer has the same isolation or globals.

`src/native/` contains macOS helpers. `scripts/build-native.mjs` and packaging
configuration determine what ships. A helper present in source is not evidence
that it exists in the installed app.

## Change map

| Responsibility | Main owner | Renderer owner |
| --- | --- | --- |
| Available commands and discovery | `src/main/commands.ts` | `App.tsx`, `hooks/useLauncherWindowShownHandler.ts` |
| Root result ranking and sections | `src/shared/root-search-ranking-state.ts` normalizes shared ranking state | `hooks/useLauncherCommandModel.ts`, `utils/root-search-ranking.ts`, `utils/root-search-sections.ts` |
| Command execution and view routing | `runCommandById` in `src/main/main.ts` | `hooks/useLauncherCommandExecution.ts`, `hooks/useAppViewManager.ts` |
| Keyboard and composition | Global/native shortcuts in `src/main/main.ts` and `src/native/` | `hooks/useLauncherKeyboardControls.ts`, `utils/keyboard.ts` |
| Files and file icons | `src/main/file-search-index.ts`, file IPC in `main.ts` | `App.tsx`, `FileSearchExtension.tsx`, `utils/launcher-file-results.ts` |
| Browser history and tabs | `src/main/browser-search-history.ts`, `src/main/browser-tabs.ts` | `hooks/useBrowserSearch.ts`, `hooks/useBrowserResultsController.ts` |
| Web search and bangs | `src/main/web-search-bangs.ts` and web-search IPC | `hooks/useWebSearchController.ts`, `utils/web-search-bangs.ts` |
| Extension acquisition/building | `src/main/extension-registry.ts`, `src/main/extension-runner.ts` | `settings/StoreTab.tsx`, `settings/ExtensionsTab.tsx` |
| Extension execution and compatibility | Extension IPC in `src/main/main.ts` | `ExtensionView.tsx`, `raycast-api/` |
| Background command scheduling | Script and extension runners | `hooks/useBackgroundRefresh.ts`, `hooks/useMenuBarExtensions.ts` |
| Settings and credentials | `src/main/settings-store.ts`, `src/main/safe-storage.ts`, `src/main/extension-preferences-store.ts` | `settings/`, `utils/extension-preferences.ts` |
| Quick links and scripts | `src/main/quicklink-store.ts`, `src/main/script-command-runner.ts` | `QuickLinkManager.tsx`, launcher execution hooks |
| AI chat and cursor prompts | `src/main/ai-provider.ts`, `src/main/ai-chat-store.ts`, streaming IPC | `hooks/useAiChat.ts`, `hooks/useCursorPrompt.ts`, corresponding `views/` |
| Speech and native process lifetimes | `src/main/main.ts`, `src/native/` | `hooks/useWhisperManager.ts`, `hooks/useSpeakManager.ts` |
| Crash recovery | `src/main/renderer-recovery.ts` and window wiring | `main.tsx`, `utils/reload-budget.ts` |

Renderer paths in the last column are under `src/renderer/src/`.
`src/shared/root-search-ranking-state.ts` owns ranking state normalization and
limits; renderer ranking helpers compute match scores and ordering.

## Boundaries introduced by the first maintenance PRs

The [audit](maintenance/2026-11-03-audit.md#implementation-and-evidence) links the
independent PRs that introduce these owners. When working on a branch that has
not included those PRs, use the baseline locations above.

| Owner | Responsibility | Integration point |
| --- | --- | --- |
| `src/main/command-catalog-cache.ts` | Discovery generations, shared refresh work, stale fallback, retry and publication | `commands.ts` owns discovery; `main.ts` subscribes to publication |
| `src/main/extension-install.ts` | Staging, per-name exclusion, replacement and recovery | `extension-registry.ts` acquires candidates and `extension-runner.ts` builds them |
| `src/main/extension-archive.ts` | Validate the complete archive before confined extraction | Registry download paths |
| `src/main/applescript.ts` | Interpreter process, stdin/output limits, termination and settlement | The `run-applescript` IPC handler |
| `src/renderer/src/utils/background-scheduler.ts` | Stable due times, in-flight exclusion and retired-task guards | `hooks/useBackgroundRefresh.ts` owns feature-specific effects |
| `src/shared/file-search-text.ts` | Unicode name normalization and tokenization | Main file index and renderer file-result filter |

Credential durability stays in `src/main/safe-storage.ts`: callers receive
success only after file replacement, and caches reflect that committed state.
These interfaces keep ownership explicit without changing public extension APIs.

## Trace a feature before editing it

For a launcher command, trace discovery in `commands.ts`, the `get-commands`
bridge, command modeling, keyboard selection, and execution. Cache publication
and renderer notification are separate events; a change is not visible merely
because disk state changed.

For an extension, trace acquisition, bundle construction, `ExtensionView` require
resolution, and the focused compatibility module. See the
[runtime map](raycast-runtime.md) for files and current isolation limits.

For persistent state, find the disk owner and every in-memory or localStorage
copy. A successful return used to authorize deletion of a legacy copy must mean
the replacement is durable. Preserve unreadable encrypted data.

For timers or native processes, find creation, replacement, callbacks, and
cleanup together. A completion from an old instance must not modify the new
instance. A fresh object containing equivalent command metadata should not
reset an unchanged schedule.

## Documentation ownership

`AGENTS.md` contains shared working rules; `CLAUDE.md` only routes to it. The
[personal requirements](../.agents/skills/personal-requirements/SKILL.md) define
product scope. The [cloud build skill](../.agents/skills/cloud-build/SKILL.md)
owns build and artifact procedures. `package.json` and the workflow remain the
source of commands and runner configuration.

`docs/dev-notes/` and `docs/superpowers/` are historical records, not current
acceptance evidence. The [maintenance audit](maintenance/2026-11-03-audit.md)
records source findings against a fixed baseline; its follow-up items need their
own tests before a fix can be called verified.
