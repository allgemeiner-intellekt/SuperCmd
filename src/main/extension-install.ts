import * as fs from 'fs';
import * as path from 'path';
import { isCommandPlatformCompatible, isManifestPlatformCompatible } from './extension-platform';

export function isSafeExtensionName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

/** Resolve untrusted archive, tree or manifest paths without normalizing away traversal. */
export function confinedExtensionPath(root: string, relative: string): string {
  if (!relative || relative.includes('\0') || relative.includes('\\') ||
      path.posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) ||
      relative.split('/').includes('..')) {
    throw new Error(`Unsafe extension path: ${JSON.stringify(relative)}`);
  }
  const resolved = path.resolve(root, relative);
  const within = path.relative(path.resolve(root), resolved);
  if (within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
    throw new Error(`Extension path escapes its directory: ${relative}`);
  }
  return resolved;
}

/** Refuse links in acquired source before dependency tools or the builder read it. */
export function assertExtensionSourceTree(root: string): void {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error(`Unsupported extension file: ${root}`);
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(root)) assertExtensionSourceTree(path.join(root, entry));
  }
}

/** Check existing components as well as lexical confinement before reading/writing a file. */
export function assertNoExtensionSymlinks(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative) confinedExtensionPath(root, relative.split(path.sep).join('/'));
  let current = root;
  for (const component of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Extension path contains a symlink: ${current}`);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export function readExtensionInstallManifest(extPath: string): any {
  const manifestPath = path.join(extPath, 'package.json');
  assertNoExtensionSymlinks(extPath, manifestPath);
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!pkg || typeof pkg !== 'object' || !Array.isArray(pkg.commands)) {
    throw new Error('Extension manifest must contain a commands array (which may be empty)');
  }
  if (!isManifestPlatformCompatible(pkg)) throw new Error('Extension does not support this platform');
  const names = new Set<string>();
  for (const cmd of pkg.commands) {
    if (!cmd || typeof cmd.name !== 'string' || !cmd.name.trim() || cmd.name !== cmd.name.trim()) {
      throw new Error('Extension manifest contains an invalid command name');
    }
    const output = confinedExtensionPath(path.join(extPath, '.sc-build'), `${cmd.name}.js`);
    const key = output.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate extension command: ${cmd.name}`);
    names.add(key);
    for (const field of ['path', 'entrypoint', 'entry', 'file', 'source']) {
      if (typeof cmd[field] === 'string' && cmd[field]) confinedExtensionPath(extPath, cmd[field]);
    }
  }
  return pkg;
}

/** A source build's count is not a success flag: every applicable command must exist. */
export function validateExtensionBuild(extPath: string, pkg: any, builtCount?: number): void {
  const commands = pkg.commands.filter(isCommandPlatformCompatible);
  if (builtCount !== undefined && builtCount !== commands.length) {
    throw new Error(`Extension build incomplete: built ${builtCount}/${commands.length} supported commands`);
  }
  // Explicit commands: [] and manifests with no commands for this platform are
  // valid metadata-only installs. They do not need a .sc-build directory.
  for (const cmd of commands) {
    const output = confinedExtensionPath(path.join(extPath, '.sc-build'), `${cmd.name}.js`);
    assertNoExtensionSymlinks(extPath, output);
    const stat = fs.statSync(output);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or empty command bundle: ${cmd.name}`);
  }
}

const pendingInstalls = new Map<string, Promise<void>>();

/** One lock covers all fallbacks and uninstall; case aliases also serialize on macOS. */
export async function withExtensionInstallLock<T>(
  extensionsDir: string,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isSafeExtensionName(name)) throw new Error('Invalid extension name');
  const key = path.resolve(extensionsDir, name).toLowerCase();
  const previous = pendingInstalls.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  pendingInstalls.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pendingInstalls.get(key) === current) pendingInstalls.delete(key);
  }
}

export class ExtensionInstallRecoveryError extends Error {
  constructor(public readonly backupPath: string, replaceError: unknown, restoreError: unknown) {
    super(`Extension replacement failed (${String(replaceError)}); restore failed (${String(restoreError)}). Previous installation retained at ${backupPath}`);
    this.name = 'ExtensionInstallRecoveryError';
  }
}

/**
 * Caller holds the name lock. Preparation must return a validated directory
 * under workDir. No live files move until preparation finishes successfully.
 */
export async function installStagedExtension(
  extensionsDir: string,
  name: string,
  prepare: (workDir: string) => Promise<string>,
): Promise<void> {
  if (!isSafeExtensionName(name)) throw new Error('Invalid extension name');
  const installPath = path.join(extensionsDir, name);
  // A sibling on the same filesystem permits rename and stays outside discovery.
  const workDir = fs.mkdtempSync(path.join(path.dirname(extensionsDir), '.extension-install-'));
  const backupPath = path.join(workDir, 'previous');
  let retainBackup = false;
  try {
    const candidate = await prepare(workDir);
    const relative = path.relative(workDir, candidate);
    if (!relative || confinedExtensionPath(workDir, relative) !== path.resolve(candidate) || candidate === backupPath) {
      throw new Error('Invalid staged extension directory');
    }
    assertNoExtensionSymlinks(workDir, candidate);
    if (!fs.statSync(candidate).isDirectory()) throw new Error('Staged extension is not a directory');

    let hadExistingInstall = false;
    try {
      // lstat includes broken symlinks; rename never follows their targets.
      fs.lstatSync(installPath);
      hadExistingInstall = true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (hadExistingInstall) fs.renameSync(installPath, backupPath);
    try {
      fs.renameSync(candidate, installPath);
    } catch (replaceError) {
      if (hadExistingInstall) {
        try {
          fs.renameSync(backupPath, installPath);
        } catch (restoreError) {
          retainBackup = true;
          throw new ExtensionInstallRecoveryError(backupPath, replaceError, restoreError);
        }
      }
      throw replaceError;
    }
  } finally {
    if (!retainBackup) {
      // Cleanup cannot turn a successful commit into a destructive rollback.
      try { fs.rmSync(workDir, { recursive: true, force: true }); }
      catch (error) { console.warn(`Could not clean extension staging directory ${workDir}:`, error); }
    }
  }
}
