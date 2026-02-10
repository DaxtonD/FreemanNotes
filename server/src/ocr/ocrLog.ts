type OcrLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

type LevelNum = 0 | 1 | 2 | 3 | 4 | 5;

const LEVELS: Record<OcrLogLevel, LevelNum> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

function parseLevel(raw: unknown): OcrLogLevel {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'info';
  if (s in LEVELS) return s as OcrLogLevel;
  if (s === 'none' || s === 'off') return 'silent';
  if (s === 'warning') return 'warn';
  return 'info';
}

function currentLevel(): LevelNum {
  return LEVELS[parseLevel(process.env.OCR_LOG_LEVEL)];
}

function shouldLog(level: OcrLogLevel): boolean {
  return currentLevel() >= LEVELS[level];
}

function safeExtra(extra: unknown): unknown {
  if (extra == null) return undefined;
  if (typeof extra === 'string') return extra;
  if (typeof extra === 'number' || typeof extra === 'boolean') return extra;
  try {
    return JSON.parse(JSON.stringify(extra));
  } catch {
    return String(extra);
  }
}

export function ocrLog(level: OcrLogLevel, msg: string, extra?: unknown): void {
  if (!shouldLog(level)) return;
  const payload = safeExtra(extra);
  const prefix = `[OCR] ${msg}`;

  try {
    if (level === 'error') console.error(prefix, payload ?? '');
    else if (level === 'warn') console.warn(prefix, payload ?? '');
    else if (level === 'trace') console.debug(prefix, payload ?? '');
    else console.info(prefix, payload ?? '');
  } catch {
    // never throw from logging
  }
}

export function ocrDebugEnabled(): boolean {
  return shouldLog('debug') || shouldLog('trace');
}

export function tailString(s: unknown, max = 1200): string {
  const str = String(s ?? '');
  if (str.length <= max) return str;
  return str.slice(0, max) + `…(+${str.length - max} chars)`;
}

export function summarizeOcrInputUrl(url: string): { kind: 'uploads' | 'http' | 'dataUrl' | 'other'; summary: string } {
  const u = String(url || '');
  if (/^data:[^;]+;base64,/i.test(u)) {
    return { kind: 'dataUrl', summary: `dataUrl(len=${u.length})` };
  }
  if (u.startsWith('/uploads/')) {
    const rel = u.replace(/^\/uploads\//, '').split('?')[0];
    return { kind: 'uploads', summary: `/uploads/${rel}` };
  }
  if (/^https?:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname;
      const path = parsed.pathname;
      return { kind: 'http', summary: `${parsed.protocol}//${host}${path}` };
    } catch {
      return { kind: 'http', summary: u.slice(0, 200) };
    }
  }
  return { kind: 'other', summary: u.slice(0, 200) };
}
