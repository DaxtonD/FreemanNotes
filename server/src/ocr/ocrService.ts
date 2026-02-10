import crypto from 'crypto';

import type { ImageInput, OcrOutcome } from './types';
import { preprocessForOcr } from './imagePreprocess';
import { runPaddleOcrOnPng } from './paddleRunner';
import { normalizeOcrLines } from './textNormalize';
import { resolveImageBuffer } from './imageInput';

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function extractOcrFromImage(input: ImageInput, opts?: { lang?: string }): Promise<OcrOutcome> {
  const resolved = await resolveImageBuffer(input);
  if (resolved.ok !== true) return resolved;

  const original = resolved.buffer;
  if (!original || !Buffer.isBuffer(original) || original.length < 8) {
    return { ok: false, code: 'INVALID_IMAGE', message: 'Image buffer is empty or invalid.' };
  }

  let preprocessed: Buffer;
  try {
    preprocessed = await preprocessForOcr(original);
  } catch (e) {
    return { ok: false, code: 'INVALID_IMAGE', message: 'Failed to preprocess image for OCR.', cause: String(e) };
  }

  const structured = await runPaddleOcrOnPng(preprocessed, { lang: opts?.lang });
  if (!('engine' in structured)) return structured;

  const normalized = normalizeOcrLines(structured.lines);

  return {
    ok: true,
    result: {
      rawText: normalized.rawText,
      searchText: normalized.searchText,
      structured,
    },
  };
}
