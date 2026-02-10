import * as fs from 'fs/promises';
import * as path from 'path';

import type { ImageInput, OcrFailure } from './types';
import { getUploadsDir } from '../uploads';

function err(code: OcrFailure['code'], message: string, cause?: unknown): OcrFailure {
  return { ok: false, code, message, cause: cause ? String(cause) : undefined };
}

export function isDataUrl(s: string): boolean {
  return /^data:[^;]+;base64,/i.test(String(s || ''));
}

export function parseDataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/i);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
}

export async function resolveImageBuffer(input: ImageInput): Promise<{ ok: true; buffer: Buffer; filenameHint?: string } | OcrFailure> {
  try {
    if (input.kind === 'buffer') {
      return { ok: true, buffer: input.buffer, filenameHint: input.filenameHint };
    }

    if (input.kind === 'path') {
      const buf = await fs.readFile(input.path);
      return { ok: true, buffer: buf, filenameHint: path.basename(input.path) };
    }

    if (input.kind === 'dataUrl') {
      const buf = parseDataUrlToBuffer(input.dataUrl);
      if (!buf) return err('INVALID_IMAGE', 'Invalid data URL (expected base64 data URL).');
      return { ok: true, buffer: buf, filenameHint: 'image' };
    }

    if (input.kind === 'url') {
      const url = String(input.url || '');
      if (isDataUrl(url)) {
        const buf = parseDataUrlToBuffer(url);
        if (!buf) return err('INVALID_IMAGE', 'Invalid data URL (expected base64 data URL).');
        return { ok: true, buffer: buf, filenameHint: 'image' };
      }

      if (url.startsWith('/uploads/')) {
        // Map app-public uploads path to local filesystem in this server.
        const uploadsDir = getUploadsDir();
        const rel = url.replace(/^\/uploads\//, '');
        const filePath = path.join(uploadsDir, rel.split('?')[0]);
        const buf = await fs.readFile(filePath);
        return { ok: true, buffer: buf, filenameHint: path.basename(filePath) };
      }

      if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url);
        if (!res.ok) return err('FETCH_FAILED', `Failed to fetch image URL: ${res.status} ${res.statusText}`);
        const ab = await res.arrayBuffer();
        return { ok: true, buffer: Buffer.from(ab), filenameHint: 'image' };
      }

      return err('INVALID_IMAGE', 'Unsupported URL scheme for OCR input.');
    }

    // Exhaustiveness
    return err('INVALID_IMAGE', 'Unsupported image input.');
  } catch (e) {
    return err('UNKNOWN', 'Failed to resolve image input to bytes.', e);
  }
}
