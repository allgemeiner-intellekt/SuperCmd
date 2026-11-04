import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { assertNoExtensionSymlinks, confinedExtensionPath } from './extension-install';

function tarString(field: Buffer): string {
  const end = field.indexOf(0);
  if (end >= 0 && field.subarray(end).some((byte) => byte !== 0)) throw new Error('Invalid tar string');
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}

function tarOctal(field: Buffer): number {
  const text = field.toString('ascii').trim().replace(/\0+$/, '').trim();
  if (field.some((byte) => byte > 127) || !/^[0-7]+$/.test(text)) throw new Error('Invalid tar length or checksum');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid tar length');
  return value;
}

function readPax(data: Buffer): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    if (space < 0) throw new Error('Invalid PAX record length');
    const rawLength = data.subarray(offset, space).toString('ascii');
    const length = Number(rawLength);
    if (!/^[1-9][0-9]*$/.test(rawLength) || !Number.isSafeInteger(length) ||
        length <= space - offset + 1 || length > data.length - offset) {
      throw new Error('Invalid PAX record length');
    }
    const end = offset + length;
    if (data[end - 1] !== 10) throw new Error('Truncated PAX record');
    const record = data.subarray(space + 1, end - 1).toString('utf8');
    const equal = record.indexOf('=');
    if (equal <= 0) throw new Error('Invalid PAX record');
    fields[record.slice(0, equal)] = record.slice(equal + 1);
    offset = end;
  }
  return fields;
}

/** Extract regular files/directories only, validating the entire tar before writing. */
export function extractExtensionTarGz(buffer: Buffer, destDir: string): void {
  const tar = zlib.gunzipSync(buffer);
  const entries: Array<{ target: string; directory: boolean; offset: number; size: number }> = [];
  let offset = 0;
  let ended = false;
  let pendingPath: string | undefined;
  let pendingPax: Record<string, string> | undefined;
  let globalPax: Record<string, string> = Object.create(null);

  while (offset < tar.length) {
    if (tar.length - offset < 512) throw new Error('Truncated tar header');
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (tar.length - offset < 1024 || tar.length % 512 !== 0 ||
          tar.subarray(offset).some((byte) => byte !== 0)) throw new Error('Truncated or invalid tar terminator');
      ended = true;
      break;
    }
    const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (tarOctal(header.subarray(148, 156)) !== checksum) throw new Error('Invalid tar checksum');
    const type = header[156];
    const name = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const headerName = prefix ? `${prefix}/${name}` : name;
    // Check even metadata/unsupported header names; none may escape staging.
    confinedExtensionPath(destDir, headerName);
    let size = tarOctal(header.subarray(124, 136));
    const metadata = type === 120 || type === 103 || type === 76; // PAX x/g, GNU long name
    const pax = { ...globalPax, ...pendingPax };
    if (!metadata && pax.size !== undefined) {
      if (!/^[0-9]+$/.test(pax.size) || !Number.isSafeInteger(Number(pax.size))) throw new Error('Invalid PAX size');
      size = Number(pax.size);
    }
    offset += 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(paddedSize) || paddedSize > tar.length - offset) throw new Error('Truncated tar entry');

    if (metadata) {
      const data = tar.subarray(offset, offset + size);
      if (type === 76) {
        pendingPath = tarString(data);
        confinedExtensionPath(destDir, pendingPath);
      } else {
        const fields = readPax(data);
        if (fields.path !== undefined) confinedExtensionPath(destDir, fields.path);
        if (fields.linkpath !== undefined) throw new Error('Tar links are not supported');
        if (Object.keys(fields).some((key) => /sparse/i.test(key))) throw new Error('Sparse tar entries are not supported');
        if (type === 103) globalPax = { ...globalPax, ...fields };
        else pendingPax = { ...pendingPax, ...fields };
      }
    } else {
      if (type !== 0 && type !== 48 && type !== 53) throw new Error(`Unsupported tar entry type: ${type}`);
      const target = confinedExtensionPath(destDir, pax.path ?? pendingPath ?? headerName);
      const directory = type === 53;
      if (directory && size !== 0) throw new Error('Invalid tar directory length');
      if (!directory && target === path.resolve(destDir)) throw new Error('Invalid tar file path');
      entries.push({ target, directory, offset, size });
      pendingPath = undefined;
      pendingPax = undefined;
    }
    offset += paddedSize;
  }
  if (!ended || pendingPath !== undefined || pendingPax !== undefined) throw new Error('Truncated tar archive');

  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of entries) {
    assertNoExtensionSymlinks(destDir, entry.target);
    if (entry.directory) fs.mkdirSync(entry.target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(entry.target), { recursive: true });
      const fd = fs.openSync(entry.target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644);
      try { fs.writeFileSync(fd, tar.subarray(entry.offset, entry.offset + entry.size)); }
      finally { fs.closeSync(fd); }
    }
  }
}
