# Raycast compatibility runtime

Read this when changing extension loading, `@raycast/api`, or `@raycast/utils`.
The file map locates implementations; it is not proof of API parity.

## Execution and ownership

`src/main/extension-registry.ts` acquires and installs extensions.
`src/main/extension-runner.ts` builds command code with esbuild and returns bundles.
`src/renderer/src/ExtensionView.tsx` evaluates those bundles and supplies the require
shim, including the host React instance and the compatibility exports. Keep
extension code unmodified; compatibility fixes belong in SuperCmd.

`src/renderer/src/raycast-api/index.tsx` configures and exports the focused runtime
modules, but still owns substantial storage, toast, clipboard, and AI behavior.
Prefer changing the existing focused module. Extract a remaining responsibility
when a small interface lets callers and tests exercise the same behavior.

The launcher permits Node access for extension compatibility. Other windows have
different isolation settings. Extensions share React and runtime state; these
contexts are not security sandboxes or independent JavaScript realms.

## Compatibility evidence and limits

- OAuth has an implementation in `oauth/`, including PKCE, provider presets and
  auth-gate UI. Its presence does not prove every provider flow works.
- `BrowserExtension` in `platform-runtime.ts` still returns empty results with a
  warning. `getSelectedFinderItems` also returns an empty array in `index.tsx`.
- `getSelectedText` depends on source-app behavior and macOS permissions.
- `environment.raycastVersion` is a compatibility string, not a conformance test
  or the installed `@raycast/api` dependency version. Inspect both sources when
  assessing a version mismatch.
- Async hooks, extension context, and local storage have known lifecycle and
  isolation gaps. Read the [maintenance audit](maintenance/2026-11-03-audit.md)
  before changing those paths. Do not use an old “implemented” label as evidence.

For a changed contract, consult the [official API reference](https://developers.raycast.com/api-reference/),
add behavior tests for the exact contract, and identify the real extension used
for runtime verification. Record untested provider or permission-dependent paths.

## Silent command status

No-view commands report progress through `showMemoryStatusBar` in the main
process or `window.electron.reportNoViewStatus` in the renderer. Preserve silent
execution: these commands should not open the launcher just to show progress.
Follow `NoViewRunner` in `ExtensionView.tsx` and toast/HUD forwarding in
`raycast-api/index.tsx` when changing completion reporting.

## File map

Paths below are relative to the repository root.


Use this map when working in the Raycast compatibility layer:

- `src/renderer/src/raycast-api/index.tsx`
  Purpose: Main compatibility integration entrypoint and export surface for `@raycast/api` + `@raycast/utils`.
  Use for: top-level wiring between component runtimes, hook runtimes, and shared API exports.

- `src/renderer/src/raycast-api/action-runtime.tsx`
  Purpose: Action runtime entrypoint.
  Use for: wiring `Action`, `ActionPanel`, action registry hooks, shortcut helpers, and action overlay extraction.

- `src/renderer/src/raycast-api/action-runtime-registry.tsx`
  Purpose: Action registration + execution semantics.
  Use for: `ActionRegistryContext`, `useCollectedActions`, `useActionRegistration`, and action executor behavior.

- `src/renderer/src/raycast-api/action-runtime-overlay.tsx`
  Purpose: Action overlay rendering and static action extraction.
  Use for: `ActionPanelOverlay` UI and `extractActionsFromElement` fallback.

- `src/renderer/src/raycast-api/action-runtime-components.tsx`
  Purpose: `Action` / `ActionPanel` component surface.
  Use for: action component registration wrappers (`CopyToClipboard`, `SubmitForm`, `Push`, etc.).

- `src/renderer/src/raycast-api/action-runtime-shortcuts.tsx`
  Purpose: Shortcut matching/rendering helpers.
  Use for: `matchesShortcut`, `isMetaK`, and shortcut badge rendering.

- `src/renderer/src/raycast-api/form-runtime.tsx`
  Purpose: Form container runtime.
  Use for: form action handling, footer/actions UI, keyboard shortcuts, and context wiring.

- `src/renderer/src/raycast-api/form-runtime-fields.tsx`
  Purpose: Form field component implementations.
  Use for: `Form.TextField`, `TextArea`, `Dropdown`, `DatePicker`, `FilePicker`, etc.

- `src/renderer/src/raycast-api/form-runtime-context.tsx`
  Purpose: Form context and global form snapshots.
  Use for: `getFormValues`/`getFormErrors` data used by `Action.SubmitForm`.

- `src/renderer/src/raycast-api/list-runtime.tsx`
  Purpose: List container runtime.
  Use for: selection/filtering/grouping logic, action overlay integration, and `List` surface wiring.

- `src/renderer/src/raycast-api/list-runtime-hooks.ts`
  Purpose: List registry/grouping helper hooks.
  Use for: list item registry snapshots, emoji-grid heuristics, and grouped-section derivation.

- `src/renderer/src/raycast-api/list-runtime-renderers.tsx`
  Purpose: List row renderers and list subcomponents.
  Use for: `List.Item` registration, row visuals, emoji grid cells, `List.EmptyView`, `List.Dropdown`.

- `src/renderer/src/raycast-api/list-runtime-detail.tsx`
  Purpose: `List.Item.Detail` runtime helpers.
  Use for: markdown detail rendering and image source normalization.

- `src/renderer/src/raycast-api/list-runtime-types.tsx`
  Purpose: List runtime types + contexts.
  Use for: list registry contracts and empty-view registry context.

- `src/renderer/src/raycast-api/grid-runtime.tsx`
  Purpose: Grid container runtime.
  Use for: grid selection/filter/action handling and `Grid` surface wiring.

- `src/renderer/src/raycast-api/grid-runtime-hooks.ts`
  Purpose: Grid registry/grouping helper hooks.
  Use for: grid registry snapshots and grouped-section derivation.

- `src/renderer/src/raycast-api/grid-runtime-items.tsx`
  Purpose: Grid item registration and cell renderer primitives.
  Use for: `Grid.Item`, `Grid.Section`, and grid cell image rendering behavior.

- `src/renderer/src/raycast-api/icon-runtime.tsx`
  Purpose: Public barrel for icon runtime exports.
  Use for: `configureIconRuntime`, `Icon`, `Color`, `Image`, `Keyboard`, `renderIcon`, `resolveIconSrc`.

- `src/renderer/src/raycast-api/icon-runtime-config.ts`
  Purpose: Shared runtime configuration for icon resolution.
  Use for: wiring `getExtensionContext` into icon asset resolution.

- `src/renderer/src/raycast-api/icon-runtime-phosphor.tsx`
  Purpose: Raycast icon-name to Phosphor icon mapping/resolution.
  Use for: adding or fixing icon token mappings and fallback icon behavior.

- `src/renderer/src/raycast-api/icon-runtime-assets.tsx`
  Purpose: Asset path normalization and icon source/tint helpers.
  Use for: `sc-asset://` handling, local asset existence checks, icon tint masking.

- `src/renderer/src/raycast-api/icon-runtime-render.tsx`
  Purpose: Icon renderer implementation.
  Use for: object/string icon rendering, file icon fallback, `Color`/`Image`/`Keyboard` constants.

- `src/renderer/src/raycast-api/platform-runtime.ts`
  Purpose: Platform-facing runtime helpers.
  Use for: `WindowManagement`, `BrowserExtension` stubs, `Tool` types, `executeSQL`, `withCache`.

- `src/renderer/src/raycast-api/misc-runtime.ts`
  Purpose: Misc API exports extracted from index.
  Use for: preferences proxy/types, command metadata updates, deeplink creation.

- `src/renderer/src/raycast-api/utility-runtime.ts`
  Purpose: Shared utility helpers extracted from index.
  Use for: favicon/avatar/progress icons, AppleScript execution, failure toasts.

- `src/renderer/src/raycast-api/storage-events.ts`
  Purpose: Extension storage change event bridge.
  Use for: emitting `sc-extension-storage-changed` from shared storage mutations.

- `src/renderer/src/raycast-api/context-scope-runtime.ts`
  Purpose: Extension context snapshot/scope runtime.
  Use for: safely running async callbacks with the extension context they were created with.

- `src/renderer/src/raycast-api/oauth/index.ts`
  Purpose: Public OAuth barrel.
  Use for: `OAuth`, `OAuthService`, `withAccessToken`, token access helpers.

- `src/renderer/src/raycast-api/oauth/runtime-config.ts`
  Purpose: OAuth runtime dependency injection.
  Use for: wiring `getExtensionContext`, `open`, and icon resolution into OAuth modules.

- `src/renderer/src/raycast-api/oauth/oauth-bridge.ts`
  Purpose: OAuth callback bridge and callback parsing/wait helpers.
  Use for: callback URL parsing, callback queue/waiters, redirect URI generation.

- `src/renderer/src/raycast-api/oauth/oauth-client.ts`
  Purpose: PKCE client/token compatibility helpers.
  Use for: provider token persistence, PKCE request generation, OAuth compatibility objects.

- `src/renderer/src/raycast-api/oauth/oauth-service-core.ts`
  Purpose: OAuthService core authorization flow.
  Use for: authorize URL handling, token exchange, stored-token retrieval.

- `src/renderer/src/raycast-api/oauth/oauth-service.ts`
  Purpose: OAuthService public class + provider factory methods.
  Use for: provider presets (`linear`, `spotify`, `jira`, etc.).

- `src/renderer/src/raycast-api/oauth/with-access-token.tsx`
  Purpose: `withAccessToken` HOC and runtime auth gate UI.
  Use for: auth-required rendering, callback refresh flow, token state accessors.

- `src/renderer/src/raycast-api/hooks/use-cached-state.ts`
  Purpose: Extracted `useCachedState` hook.
  Use for: persistent local state backed by localStorage.

- `src/renderer/src/raycast-api/hooks/use-promise.ts`
  Purpose: Extracted `usePromise` hook.
  Use for: async execution lifecycle (`data/isLoading/error`) and mutate/revalidate support.

- `src/renderer/src/raycast-api/hooks/use-fetch.ts`
  Purpose: Extracted `useFetch` hook.
  Use for: HTTP requests with optional pagination accumulation and mutate/revalidate behavior.

- `src/renderer/src/raycast-api/hooks/use-cached-promise.ts`
  Purpose: Extracted `useCachedPromise` hook.
  Use for: cached async execution with optional cursor/page pagination pattern.

- `src/renderer/src/raycast-api/hooks/use-form.ts`
  Purpose: Extracted `FormValidation` + `useForm`.
  Use for: form state, validation, and generated field props.

- `src/renderer/src/raycast-api/hooks/use-exec.ts`
  Purpose: Extracted `useExec` hook.
  Use for: running shell commands through Electron IPC.

- `src/renderer/src/raycast-api/hooks/use-sql.ts`
  Purpose: Extracted `useSQL` hook.
  Use for: running sqlite queries through Electron IPC.

- `src/renderer/src/raycast-api/hooks/use-stream-json.ts`
  Purpose: Extracted `useStreamJSON` hook.
  Use for: fetch + transform/filter + client-side pagination for JSON APIs.

- `src/renderer/src/raycast-api/hooks/use-ai.ts`
  Purpose: Extracted `useAI` hook.
  Use for: prompt execution with streaming/non-streaming result handling.

- `src/renderer/src/raycast-api/hooks/use-frecency-sorting.ts`
  Purpose: Extracted `useFrecencySorting` hook.
  Use for: frequency+recency ranking and visit tracking.

- `src/renderer/src/raycast-api/hooks/use-local-storage.ts`
  Purpose: Extracted `useLocalStorage` hook.
  Use for: synchronized localStorage state with extension storage-change events.

- `src/renderer/src/raycast-api/raycast-icon-enum.ts`
  Purpose: Canonical Raycast icon enum/value mapping used by icon resolution (auto-generated).
  Use for: adding/fixing icon names and legacy icon token compatibility.

AI requests without a model follow the common LLM configuration. Explicit OpenAI
models use the OpenAI Responses transport. Anthropic/Claude, Gemini, Ollama and
LM Studio model identifiers return a provider-removed error before network IO.
Custom model identifiers keep the existing OpenAI-compatible transport.
