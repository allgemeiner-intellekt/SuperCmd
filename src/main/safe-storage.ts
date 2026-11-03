/**
 * Safe Storage Vault
 *
 * Wraps Electron's `safeStorage` API to persist secrets encrypted on disk
 * (macOS Keychain on Mac, DPAPI on Windows, libsecret/kwallet on Linux).
 *
 * On disk format (~/Library/Application Support/SuperCmd/safe-storage.json):
 *   { "<key>": "enc:<base64-encrypted>" }
 *
 * If the OS keyring is not available we degrade gracefully and persist
 * plain text — which is no worse than the legacy settings.json behaviour
 * we are replacing — and never silently lose user data.
 *
 * IMPORTANT: encrypted entries we cannot decrypt in this session (e.g.
 * encryption temporarily unavailable, or a single corrupt blob) are
 * preserved verbatim through writes. Without this, a single failed
 * decrypt would mean a later setSecret/deleteSecret would clobber
 * unrelated secrets when the vault file was rewritten.
 */

import { app, safeStorage } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const VAULT_FILENAME = 'safe-storage.json';
const ENCRYPTED_PREFIX = 'enc:';

// Decrypted/plaintext entries we own and can re-write.
let decryptedCache: Record<string, string> | null = null;
// Raw on-disk entries we couldn't read (or chose not to read because
// encryption was unavailable). These are passed through writes verbatim
// so we never destroy a user's secrets we just couldn't open right now.
let unknownRawCache: Record<string, string> | null = null;
// Remember the bytes behind the cache so write-time revalidation does not
// repeatedly decrypt an unchanged vault. null denotes a missing file.
let cachedVaultContents: string | null = null;

function getVaultPath(): string {
  return path.join(app.getPath('userData'), VAULT_FILENAME);
}

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function loadVault(refresh = false): boolean {
  if (!refresh && decryptedCache && unknownRawCache) return true;
  try {
    let raw: string | null;
    try {
      raw = fs.readFileSync(getVaultPath(), 'utf-8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      raw = null; // Only a missing file is a safe first-run empty vault.
    }
    if (decryptedCache && unknownRawCache && raw === cachedVaultContents) return true;
    const parsed = raw === null ? {} : JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.values(parsed).some((value) => typeof value !== 'string')) {
      throw new Error('Invalid vault format');
    }
    const decrypted: Record<string, string> = Object.create(null);
    const unknownRaw: Record<string, string> = Object.create(null);
    const canDecrypt = isEncryptionAvailable();
    for (const [key, value] of Object.entries(parsed as Record<string, string>)) {
      if (value.startsWith(ENCRYPTED_PREFIX)) {
        if (!canDecrypt) {
          unknownRaw[key] = value;
          continue;
        }
        try {
          const buf = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
          decrypted[key] = safeStorage.decryptString(buf);
        } catch (e) {
          console.warn(`safe-storage: failed to decrypt key "${key}", preserving raw blob:`, e);
          unknownRaw[key] = value;
        }
      } else {
        decrypted[key] = value;
      }
    }
    decryptedCache = decrypted;
    unknownRawCache = unknownRaw;
    cachedVaultContents = raw;
    return true;
  } catch {
    // Do not cache an empty vault after an I/O or parse failure. Reads can
    // recover on the next call; mutations must leave the original file alone.
    resetVaultCache();
    // JSON parse errors can include secret bytes, so do not log the exception.
    console.error('safe-storage: vault unreadable or malformed; refusing writes.');
    return false;
  }
}

function persistVault(decrypted: Record<string, string>, unknownRaw: Record<string, string>): boolean {
  const canEncrypt = isEncryptionAvailable();
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(decrypted)) {
    if (canEncrypt) {
      try {
        const buf = safeStorage.encryptString(value);
        out[key] = ENCRYPTED_PREFIX + buf.toString('base64');
      } catch (e) {
        console.warn(`safe-storage: failed to encrypt key "${key}", storing plaintext:`, e);
        out[key] = value;
      }
    } else {
      out[key] = value;
    }
  }
  // Preserve unreadable encrypted entries verbatim so we don't destroy them
  // by rewriting the file from a partial cache.
  for (const [key, raw] of Object.entries(unknownRaw)) {
    if (key in out) continue;
    out[key] = raw;
  }
  let tempPath: string | undefined;
  let fd: number | undefined;
  try {
    const target = getVaultPath();
    const candidate = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const contents = JSON.stringify(out, null, 2);
    fd = fs.openSync(candidate, 'wx', 0o600);
    tempPath = candidate; // Clean up only a file we successfully created.
    fs.writeFileSync(fd, contents, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, target);
    tempPath = undefined;
    // The cache represents committed disk state, never an attempted write.
    decryptedCache = decrypted;
    unknownRawCache = unknownRaw;
    cachedVaultContents = contents;
    return true;
  } catch (e) {
    console.error('safe-storage: failed to write vault:', e);
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best-effort cleanup */ }
    }
    if (tempPath !== undefined) {
      try { fs.unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
    }
  }
}

export function getSecret(key: string): string {
  if (!loadVault()) return '';
  return decryptedCache![key] || '';
}

/**
 * Persist a secret to the vault. Returns `true` only when the on-disk
 * vault file is successfully written. Callers performing destructive
 * follow-ups (e.g. redacting plaintext from settings.json) MUST check
 * this return value first.
 *
 * Setting an empty value is treated as a delete.
 */
export function setSecret(key: string, value: string): boolean {
  const next = String(value ?? '');
  if (!next) return deleteSecret(key);
  // Re-read before mutations, even with a warm cache, so an unreadable or
  // externally changed file is never overwritten from a stale snapshot.
  if (!loadVault(true)) return false;
  if (decryptedCache![key] === next && unknownRawCache![key] === undefined) return true;
  const decrypted = Object.assign(Object.create(null), decryptedCache!);
  const unknownRaw = Object.assign(Object.create(null), unknownRawCache!);
  decrypted[key] = next;
  delete unknownRaw[key];
  return persistVault(decrypted, unknownRaw);
}

export function deleteSecret(key: string): boolean {
  if (!loadVault(true)) return false;
  if (decryptedCache![key] === undefined && unknownRawCache![key] === undefined) return true;
  const decrypted = Object.assign(Object.create(null), decryptedCache!);
  const unknownRaw = Object.assign(Object.create(null), unknownRawCache!);
  delete decrypted[key];
  delete unknownRaw[key];
  return persistVault(decrypted, unknownRaw);
}

export function hasSecret(key: string): boolean {
  if (!loadVault()) return false;
  const value = decryptedCache![key];
  return typeof value === 'string' && value.length > 0;
}

export function isSafeStorageAvailable(): boolean {
  return isEncryptionAvailable();
}

export function resetVaultCache(): void {
  decryptedCache = null;
  unknownRawCache = null;
  cachedVaultContents = null;
}
