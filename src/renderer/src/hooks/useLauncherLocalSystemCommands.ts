import { useCallback, useEffect } from 'react';
import type React from 'react';
import type { MemoryFeedback } from '../utils/command-helpers';
import {
  executeWindowManagementPresetCommandById,
  isWindowManagementPresetCommandId,
} from '../WindowManagerPanel';
import {
  BROWSER_SEARCH_BOOKMARKS_COMMAND_ID,
  BROWSER_SEARCH_HISTORY_COMMAND_ID,
  BROWSER_SEARCH_OPEN_TABS_COMMAND_ID,
  type BrowserResultsViewScope,
} from '../utils/browser-search-commands';
import {
  WEB_SEARCH_COMMAND_ID,
} from '../utils/web-search-bangs';

const DIRECT_LAUNCH_EXPANDED_SYSTEM_COMMAND_IDS = new Set([
  'system-clipboard-manager',
  'system-search-snippets',
  'system-create-snippet',
  'system-search-notes',
  'system-search-canvases',
  'system-search-quicklinks',
  'system-create-quicklink',
  'system-search-files',
  WEB_SEARCH_COMMAND_ID,
  BROWSER_SEARCH_OPEN_TABS_COMMAND_ID,
  BROWSER_SEARCH_BOOKMARKS_COMMAND_ID,
  BROWSER_SEARCH_HISTORY_COMMAND_ID,
  'system-my-schedule',
  'system-camera',
]);

export type RunLocalSystemCommandOptions = {
  fromMainEvent?: boolean;
};

type UseLauncherLocalSystemCommandsOptions = {
  expandLauncherForDirectLaunch: () => void;

  memoryActionLoading: boolean;
  selectedTextSnapshot: string;
  setSelectedTextSnapshot: React.Dispatch<React.SetStateAction<string>>;
  setMemoryActionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setMemoryFeedback: React.Dispatch<React.SetStateAction<MemoryFeedback>>;

  showOnboarding: boolean;
  showWindowManager: boolean;

  windowPresetCommandQueueRef: React.MutableRefObject<Promise<void>>;

  openOnboarding: () => void;

  openClipboardManager: (openedViaShortcut?: boolean) => void;
  openSnippetManager: (mode: 'search' | 'create') => void;
  openNotesSearch: () => void;
  openCanvasSearch: () => void;
  openQuickLinkManager: (mode: 'search' | 'create') => void;
  openFileSearch: () => void;
  openWebSearchMode: (initialQuery?: string) => void;
  openCamera: () => void;

  openWindowManager: () => void;
  openMenuItemSearch: () => void;
  openSchedule: () => void;

  setShowWindowManager: React.Dispatch<React.SetStateAction<boolean>>;

  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setBrowserResultsViewQuery: React.Dispatch<React.SetStateAction<string | null>>;
  setBrowserResultsViewScope: React.Dispatch<React.SetStateAction<BrowserResultsViewScope>>;
  setBrowserHistoryProfileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setWebSearchQuery: React.Dispatch<React.SetStateAction<string | null>>;

  refreshBrowserOpenTabs: () => void | Promise<void>;
  refreshBrowserEntries: () => void | Promise<void>;
  refreshBrowserEntriesIfStale: () => void | Promise<void>;
};

export function useLauncherLocalSystemCommands(
  options: UseLauncherLocalSystemCommandsOptions
): {
  runLocalSystemCommand: (
    commandId: string,
    options?: RunLocalSystemCommandOptions
  ) => Promise<boolean>;
} {
  const {
    expandLauncherForDirectLaunch,
    memoryActionLoading,
    selectedTextSnapshot,
    setSelectedTextSnapshot,
    setMemoryActionLoading,
    setMemoryFeedback,
    showOnboarding,
    showWindowManager,

    windowPresetCommandQueueRef,
    openOnboarding,

    openClipboardManager,
    openSnippetManager,
    openNotesSearch,
    openCanvasSearch,
    openQuickLinkManager,
    openFileSearch,
    openWebSearchMode,
    openCamera,

    openWindowManager,
    openMenuItemSearch,
    openSchedule,

    setShowWindowManager,
    setSearchQuery,
    setSelectedIndex,
    setBrowserResultsViewQuery,
    setBrowserResultsViewScope,
    setBrowserHistoryProfileMenuOpen,
    setWebSearchQuery,
    refreshBrowserOpenTabs,
    refreshBrowserEntries,
    refreshBrowserEntriesIfStale,
  } = options;

  const runLocalSystemCommand = useCallback(async (
    commandId: string,
    options?: RunLocalSystemCommandOptions
  ): Promise<boolean> => {
    if (DIRECT_LAUNCH_EXPANDED_SYSTEM_COMMAND_IDS.has(commandId)) {
      expandLauncherForDirectLaunch();
    }
    setBrowserResultsViewQuery(null);
    setWebSearchQuery(null);

    if (commandId === 'system-open-onboarding') {
      await window.electron.setLauncherMode('onboarding');

      openOnboarding();
      return true;
    }

    if (commandId === 'system-clipboard-manager') {

      openClipboardManager(options?.fromMainEvent === true);
      return true;
    }
    if (commandId === 'system-search-snippets') {

      openSnippetManager('search');
      return true;
    }
    if (commandId === 'system-create-snippet') {

      openSnippetManager('create');
      return true;
    }
    if (commandId === 'system-search-notes') {

      openNotesSearch();
      return true;
    }
    if (commandId === 'system-create-note') {

      window.electron.openNotesWindow('create');
      return true;
    }
    if (commandId === 'system-search-canvases') {

      openCanvasSearch();
      return true;
    }
    if (commandId === 'system-create-canvas') {

      window.electron.openCanvasWindow('create');
      return true;
    }
    if (commandId === 'system-search-quicklinks') {

      openQuickLinkManager('search');
      return true;
    }
    if (commandId === 'system-create-quicklink') {

      openQuickLinkManager('create');
      return true;
    }
    if (commandId === 'system-search-files') {

      openFileSearch();
      return true;
    }
    if (commandId === WEB_SEARCH_COMMAND_ID) {

      openWebSearchMode('');
      return true;
    }
    if (commandId === BROWSER_SEARCH_OPEN_TABS_COMMAND_ID) {

      refreshBrowserOpenTabs();
      setBrowserResultsViewScope('open-tabs');
      setBrowserResultsViewQuery('');
      return true;
    }
    if (commandId === BROWSER_SEARCH_BOOKMARKS_COMMAND_ID) {

      setBrowserResultsViewScope('bookmarks');
      setBrowserResultsViewQuery('');
      refreshBrowserEntriesIfStale();
      return true;
    }
    if (commandId === BROWSER_SEARCH_HISTORY_COMMAND_ID) {

      setBrowserHistoryProfileMenuOpen(false);
      setBrowserResultsViewScope('history');
      setBrowserResultsViewQuery('');
      refreshBrowserEntriesIfStale();
      return true;
    }
    if (commandId === 'system-my-schedule') {

      openSchedule();
      return true;
    }
    if (commandId === 'system-camera') {

      openCamera();
      return true;
    }
    if (isWindowManagementPresetCommandId(commandId)) {

      // For launcher-initiated execution, route through main first so it can
      // capture the real frontmost target window before running the preset.
      if (!options?.fromMainEvent) {
        await window.electron.executeCommand(commandId);
        return true;
      }
      const queued = windowPresetCommandQueueRef.current.then(async () => {
        const result = await executeWindowManagementPresetCommandById(commandId);
        if (result.success && document.hasFocus()) {
          try {
            await window.electron.hideWindow();
          } catch {}
        }
      });
      windowPresetCommandQueueRef.current = queued.then(() => undefined, () => undefined);
      await queued;
      return true;
    }
    if (commandId === 'system-window-management') {

      if (showWindowManager) {
        setShowWindowManager(false);
        return true;
      }
      openWindowManager();
      setSearchQuery('');
      setSelectedIndex(0);
      // Only hide when launcher is the actively focused window (launcher-invoked flow).
      // For global-hotkey/background invocation, forcing hide can cause focus churn
      // that immediately blurs and closes the detached window manager panel.
      if (document.hasFocus()) {
        try {
          await window.electron.hideWindow();
        } catch {}
      }
      return true;
    }
    if (commandId === 'system-menu-item-search') {

      // In-window view — keep the launcher open (do NOT hideWindow).
      openMenuItemSearch();
      setSearchQuery('');
      setSelectedIndex(0);
      return true;
    }
    if (commandId === 'system-cursor-prompt') {
      await window.electron.executeCommand(commandId);
      return true;
    }

    if (commandId === 'system-import-snippets') {
      await window.electron.snippetImport();
      return true;
    }
    if (commandId === 'system-export-snippets') {
      await window.electron.snippetExport();
      return true;
    }
    if (commandId === 'system-check-for-updates') {
      await window.electron.appUpdaterCheckAndInstall();
      return true;
    }
    if (commandId === 'system-update-and-reopen') {
      await window.electron.appUpdaterQuitAndInstall();
      try { await window.electron.hideWindow(); } catch {}
      return true;
    }
    if (commandId === 'system-empty-trash') {
      const ok = window.confirm('Are you sure you want to permanently delete the items in the Trash?');
      if (!ok) return true;
      await window.electron.executeCommand('system-empty-trash');
      return true;
    }
    if (commandId === 'system-reset-launcher-position') {
      await window.electron.resetLauncherPosition();
      await window.electron.hideWindow();
      return true;
    }
    return false;
  }, [
    expandLauncherForDirectLaunch,
    memoryActionLoading,
    selectedTextSnapshot,
    showOnboarding,
    showWindowManager,

    windowPresetCommandQueueRef,
    openOnboarding,

    openClipboardManager,
    openSnippetManager,
    openNotesSearch,
    openCanvasSearch,
    openQuickLinkManager,
    openFileSearch,
    openWebSearchMode,
    openCamera,

    openWindowManager,
    openMenuItemSearch,
    openSchedule,

    setShowWindowManager,
    setSearchQuery,
    setSelectedIndex,
    setSelectedTextSnapshot,
    setMemoryActionLoading,
    setMemoryFeedback,
    setBrowserResultsViewQuery,
    setBrowserResultsViewScope,
    setBrowserHistoryProfileMenuOpen,
    setWebSearchQuery,
    refreshBrowserOpenTabs,
    refreshBrowserEntries,
    refreshBrowserEntriesIfStale,
  ]);

  useEffect(() => {
    const cleanup = window.electron.onRunSystemCommand(async (commandId: string) => {
      try {
        await runLocalSystemCommand(commandId, { fromMainEvent: true });
      } catch (error) {
        console.error('Failed to run system command from main process:', error);
      }
    });
    return cleanup;
  }, [runLocalSystemCommand]);

  return { runLocalSystemCommand };
}
