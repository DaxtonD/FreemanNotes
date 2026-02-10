import type { OcrLine } from './types';

export function cleanWhitespace(s: string): string {
  return String(s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +/g, ' ')
    .trim();
}

export function normalizeOcrLines(lines: OcrLine[]): { rawText: string; searchText: string } {
  const cleaned = (Array.isArray(lines) ? lines : [])
    .map((l) => cleanWhitespace(String(l?.text || '')))
    .filter(Boolean);

  // Remove obvious duplicates (common on dense UI / repeated detections)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of cleaned) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  const rawText = deduped.join('\n').trim();
  // Search text: single line, whitespace collapsed.
  const searchText = cleanWhitespace(deduped.join(' '));
  return { rawText, searchText };
}
