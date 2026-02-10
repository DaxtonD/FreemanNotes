// Compatibility wrapper.
// The production OCR implementation lives in server/src/ocr/*.
// This file remains to avoid breaking older imports and to keep the public API simple.

import type { ImageInput, OcrOutcome } from './ocr/types';
import { extractOcrFromImage } from './ocr/ocrService';

export { extractOcrFromImage };
export type { ImageInput, OcrOutcome };

// Back-compat: returns raw text (or empty string on failure)
export async function ocrRecognize(input: Buffer | string): Promise<string> {
	const img: ImageInput = Buffer.isBuffer(input)
		? { kind: 'buffer', buffer: input }
		: ({ kind: 'dataUrl', dataUrl: String(input || '') } as any);
	const out: OcrOutcome = await extractOcrFromImage(img, { lang: 'en' });
	return out.ok ? out.result.rawText : '';
}
