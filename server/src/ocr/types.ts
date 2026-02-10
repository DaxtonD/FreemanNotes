export type OcrBox = number[][]; // [[x,y], ...] 4 points

export type OcrLine = {
  text: string;
  confidence?: number; // 0..1 (best-effort)
  box?: OcrBox;
};

export type OcrBlock = {
  lines: OcrLine[];
};

export type OcrStructuredResult = {
  blocks: OcrBlock[];
  lines: OcrLine[]; // flattened convenience
  avgConfidence?: number;
  engine: 'paddleocr';
  lang: string;
  durationMs?: number;
};

export type OcrNormalizedResult = {
  rawText: string;
  searchText: string;
  structured: OcrStructuredResult;
};

export type OcrErrorCode =
  | 'PYTHON_NOT_FOUND'
  | 'PYTHON_DEPS_MISSING'
  | 'ENGINE_FAILED'
  | 'INVALID_IMAGE'
  | 'FETCH_FAILED'
  | 'UNKNOWN';

export type OcrFailure = {
  ok: false;
  code: OcrErrorCode;
  message: string;
  cause?: string;
};

export type OcrSuccess = {
  ok: true;
  result: OcrNormalizedResult;
};

export type OcrOutcome = OcrSuccess | OcrFailure;

export type ImageInput =
  | { kind: 'buffer'; buffer: Buffer; filenameHint?: string }
  | { kind: 'path'; path: string }
  | { kind: 'dataUrl'; dataUrl: string }
  | { kind: 'url'; url: string };
