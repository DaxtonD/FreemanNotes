import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import crypto from 'crypto';

import type { OcrFailure, OcrStructuredResult } from './types';

const DEFAULT_LANG = 'en';
const PYTHON_CANDIDATES = [
  // Dockerfile sets this, but it's optional.
  process.env.PYTHON_BIN,
  'python3',
  'python',
  // Windows launcher (works without PATH python.exe)
  'py',
].filter(Boolean) as string[];

function isLikelyMissingDeps(stderr: string): boolean {
  const s = (stderr || '').toLowerCase();
  return s.includes('failed to import paddleocr') || s.includes('no module named') || s.includes('modulenotfounderror');
}

function isPythonNotFound(stderr: string, exitCode: number): boolean {
  // Windows: 9009 is commonly "command not found".
  if (exitCode === 9009) return true;
  const s = (stderr || '').toLowerCase();
  // Windows Store alias message / PATH issues
  if (s.includes('python was not found')) return true;
  if (s.includes('microsoft store')) return true;
  if (s.includes('app execution aliases')) return true;
  return false;
}

function err(code: OcrFailure['code'], message: string, cause?: unknown): OcrFailure {
  return { ok: false, code, message, cause: cause ? String(cause) : undefined };
}

async function writeTempPng(buffer: Buffer): Promise<string> {
  const name = `freemannotes-ocr-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.png`;
  const filePath = path.join(os.tmpdir(), name);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function runWithPython(
  pythonBin: string,
  scriptPath: string,
  imagePath: string,
  lang: string
): Promise<{ ok: true; out: string; err: string; code: number } | { ok: false; spawnErr: unknown }> {
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const args = pythonBin === 'py'
      ? ['-3', scriptPath, '--image', imagePath, '--lang', lang]
      : [scriptPath, '--image', imagePath, '--lang', lang];

    const proc = spawn(pythonBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (e) => {
      if (resolved) return;
      resolved = true;
      resolve({ ok: false, spawnErr: e });
    });

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      resolve({ ok: true, out: stdout, err: stderr, code: typeof code === 'number' ? code : -1 });
    });
  });
}

export async function runPaddleOcrOnPng(preprocessedPng: Buffer, opts?: { lang?: string }): Promise<OcrStructuredResult | OcrFailure> {
  const lang = (opts?.lang || DEFAULT_LANG).trim() || DEFAULT_LANG;
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'paddle_ocr.py');

  const tmpImage = await writeTempPng(preprocessedPng);
  const start = Date.now();
  try {
    for (const py of PYTHON_CANDIDATES) {
      const run = await runWithPython(py, scriptPath, tmpImage, lang);
      if (!run.ok) {
        continue;
      }

      if (run.code !== 0) {
        if (isLikelyMissingDeps(run.err)) {
          return err('PYTHON_DEPS_MISSING', 'Python is available but PaddleOCR dependencies are missing.', run.err);
        }
        // If this looks like a missing Python binary, try the next candidate.
        if (isPythonNotFound(run.err, run.code)) {
          continue;
        }
        // If the script ran but failed for a real engine reason, don't keep trying other python bins.
        return err('ENGINE_FAILED', `PaddleOCR runner failed (exit ${run.code}).`, run.err);
      }

      let parsed: any;
      try {
        parsed = JSON.parse(run.out || '{}');
      } catch (e) {
        return err('ENGINE_FAILED', 'PaddleOCR runner returned invalid JSON.', `${String(e)}; stderr=${run.err}`);
      }

      const durationMs = Date.now() - start;
      const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
      const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
      const avgConfidence = (typeof parsed?.avgConfidence === 'number') ? parsed.avgConfidence : undefined;

      return {
        engine: 'paddleocr',
        lang,
        durationMs: (typeof parsed?.durationMs === 'number') ? parsed.durationMs : durationMs,
        avgConfidence,
        lines: lines.map((l: any) => ({
          text: String(l?.text || ''),
          confidence: (typeof l?.confidence === 'number') ? l.confidence : undefined,
          box: Array.isArray(l?.box) ? l.box : undefined,
        })),
        blocks: blocks.map((b: any) => ({
          lines: Array.isArray(b?.lines)
            ? b.lines.map((l: any) => ({
                text: String(l?.text || ''),
                confidence: (typeof l?.confidence === 'number') ? l.confidence : undefined,
                box: Array.isArray(l?.box) ? l.box : undefined,
              }))
            : [],
        })),
      };
    }

    return err('PYTHON_NOT_FOUND', 'Python was not found on PATH (or the launcher failed).');
  } catch (e) {
    return err('UNKNOWN', 'Unexpected OCR runner error.', e);
  } finally {
    try { await fs.unlink(tmpImage); } catch {}
  }
}
