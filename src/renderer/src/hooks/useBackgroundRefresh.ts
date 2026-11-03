/**
 * useBackgroundRefresh.ts
 *
 * Registers interval timers for commands that declare an `interval` field (e.g. "1m", "12h").
 * - Extension commands (category: "extension", mode: "no-view" | "menu-bar"): runs the
 *   extension bundle in the background and dispatches sc-launch-extension-bundle
 * - Inline script commands (category: "script", mode: "inline"): runs the script and
 *   calls fetchCommands() to refresh the subtitle shown in the launcher
 *
 * Equivalent command snapshots keep their due times. Removed/replaced commands
 * cannot publish late results, and pending IPC/script work does not overlap.
 */

import { useRef, useEffect } from 'react';
import type { CommandInfo } from '../../types/electron';
import { parseIntervalToMs } from '../utils/command-helpers';
import { createBackgroundScheduler, type BackgroundTask } from '../utils/background-scheduler';
import {
  readJsonObject,
  getScriptCmdArgsKey,
  hydrateExtensionBundlePreferences,
  getMissingRequiredPreferences,
  getMissingRequiredArguments,
  getMissingRequiredScriptArguments,
} from '../utils/extension-preferences';

export interface UseBackgroundRefreshOptions {
  commands: CommandInfo[];
  fetchCommands: () => Promise<void>;
  /**
   * Returns true when a menu-bar command is currently mounted (visible in the
   * tray). Per Raycast's interval contract, an interval-driven re-run only
   * fires while the menu-bar item is shown — so toggling a menu-bar command
   * off must stop its background re-runs, otherwise the next tick re-mounts it.
   */
  isMenuBarCommandActive?: (extName: string, cmdName: string) => boolean;
}

export function useBackgroundRefresh({ commands, fetchCommands, isMenuBarCommandActive }: UseBackgroundRefreshOptions): void {
  const schedulerRef = useRef<ReturnType<typeof createBackgroundScheduler> | null>(null);
  const fetchCommandsRef = useRef(fetchCommands);
  fetchCommandsRef.current = fetchCommands;
  const isMenuBarCommandActiveRef = useRef(isMenuBarCommandActive);
  isMenuBarCommandActiveRef.current = isMenuBarCommandActive;

  const parseExtensionCommandPath = (pathValue: string): { extName: string; cmdName: string } | null => {
    const rawPath = String(pathValue || '').trim();
    const separatorIndex = rawPath.indexOf('/');
    if (separatorIndex <= 0 || separatorIndex >= rawPath.length - 1) return null;

    const extName = rawPath.slice(0, separatorIndex).trim();
    const cmdName = rawPath.slice(separatorIndex + 1).trim();
    if (!extName || !cmdName) return null;

    return { extName, cmdName };
  };

  useEffect(() => {
    const scheduler = createBackgroundScheduler((error, id) => {
      console.error('[BackgroundRefresh] Failed to run command:', id, error);
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const tasks: BackgroundTask[] = [];

    const extensionCommands = commands.filter(
      (cmd) => cmd.category === 'extension' && typeof cmd.interval === 'string' && cmd.path
    );

    for (const cmd of extensionCommands) {
      const ms = parseIntervalToMs(cmd.interval);
      if (!ms) continue;

      const identity = parseExtensionCommandPath(cmd.path || '');
      if (!identity) continue;
      const { extName, cmdName } = identity;

      tasks.push({
        id: cmd.id,
        intervalMs: ms,
        revision: JSON.stringify([cmd.category, cmd.mode, cmd.path]),
        run: async (isCurrent) => {
          if (cmd.mode === 'menu-bar' && isMenuBarCommandActiveRef.current
            && !isMenuBarCommandActiveRef.current(extName, cmdName)) return;
          const result = await window.electron.runExtension(extName, cmdName);
          if (!isCurrent() || !result || !result.code) return;

          const hydrated = hydrateExtensionBundlePreferences(result);
          if (hydrated.mode !== 'no-view' && hydrated.mode !== 'menu-bar') return;

          // Menu-bar interval re-runs only fire while the item is currently
          // shown — otherwise toggling a menu-bar command off would be undone
          // by the next tick re-dispatching `sc-launch-extension-bundle` →
          // upsertMenuBarExtension and the tray icon would respawn.
          if (
            hydrated.mode === 'menu-bar' &&
            isMenuBarCommandActiveRef.current &&
            !isMenuBarCommandActiveRef.current(extName, cmdName)
          ) {
            return;
          }

          const missingPrefs = getMissingRequiredPreferences(hydrated);
          const missingArgs = getMissingRequiredArguments(hydrated);
          if (missingPrefs.length > 0 || missingArgs.length > 0) return;

          window.dispatchEvent(
            new CustomEvent('sc-launch-extension-bundle', {
              detail: {
                bundle: hydrated,
                launchOptions: { type: 'background' },
                source: {
                  commandMode: 'background',
                  extensionName: hydrated.extensionName || hydrated.extName,
                  commandName: hydrated.commandName || hydrated.cmdName,
                },
              },
            })
          );
        },
      });
    }

    const inlineScriptCommands = commands.filter(
      (cmd) =>
        cmd.category === 'script' &&
        cmd.mode === 'inline' &&
        typeof cmd.interval === 'string'
    );
    for (const cmd of inlineScriptCommands) {
      const ms = parseIntervalToMs(cmd.interval);
      if (!ms) continue;

      tasks.push({
        id: cmd.id,
        intervalMs: ms,
        revision: JSON.stringify([cmd.category, cmd.mode, cmd.path]),
        run: async (isCurrent) => {
          const storedArgs = readJsonObject(getScriptCmdArgsKey(cmd.id));
          const missingArgs = getMissingRequiredScriptArguments(cmd, storedArgs);
          if (missingArgs.length > 0) return;
          const result = await window.electron.runScriptCommand({
            commandId: cmd.id,
            arguments: storedArgs,
            background: true,
          });
          if (isCurrent() && result?.mode === 'inline') {
            await fetchCommandsRef.current();
          }
        },
      });
    }

    schedulerRef.current?.reconcile(tasks);
  }, [commands]);
}
