import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type OcrLine = { text: string; confidence: number };
export type OcrResult = { text: string; lines: OcrLine[]; avgConfidence: number };
export type OcrOutcome = OcrResult | { status: 'low_confidence' };

export interface OcrEngine {
	recognize(buffer: Buffer): Promise<OcrOutcome>;
}

const LOW_CONFIDENCE_THRESHOLD = 0.55; // acceptable minimum avg confidence

function getPythonBin(): string {
	return process.env.PYTHON_BIN || 'python';
}

function writeTempImage(buffer: Buffer): Promise<string> {
	return new Promise((resolve, reject) => {
		const tmp = path.join(os.tmpdir(), `freemannotes-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
		fs.writeFile(tmp, buffer, (err) => {
			if (err) return reject(err);
			resolve(tmp);
		});
	});
}

export class PaddleOcrEngine implements OcrEngine {
	async recognize(buffer: Buffer): Promise<OcrOutcome> {
		const start = Date.now();
		const tmpPath = await writeTempImage(buffer);
		try {
			const py = getPythonBin();
			const scriptPath = path.resolve(__dirname, '../../scripts/paddle_ocr.py');
			const proc = spawn(py, [scriptPath, tmpPath], { stdio: ['ignore', 'pipe', 'pipe'] });
			let out = '';
			let err = '';
			proc.stdout.on('data', (d) => { out += d.toString(); });
			proc.stderr.on('data', (d) => { err += d.toString(); });
			const code: number = await new Promise((resolve) => proc.on('close', resolve as any));
			const elapsed = Date.now() - start;
			if (code !== 0) {
				console.warn(`[OCR] Paddle script exited with code ${code}. Elapsed ${elapsed}ms. Error: ${err.trim()}`);
				return { status: 'low_confidence' };
			}
			let parsed: any = {};
			try { parsed = JSON.parse(out || '{}'); } catch (e) { parsed = {}; }
			const avg: number = Number(parsed.avgConfidence || 0);
			console.info(`[OCR] Completed in ${elapsed}ms (python ${parsed.durationMs ?? 'n/a'}ms), avgConfidence=${avg.toFixed(3)} lines=${(parsed.lines||[]).length}`);
			if (!parsed || typeof parsed.text !== 'string') {
				return { status: 'low_confidence' };
			}
			if (avg < LOW_CONFIDENCE_THRESHOLD) {
				return { status: 'low_confidence' };
			}
			const lines: OcrLine[] = Array.isArray(parsed.lines) ? parsed.lines.map((l: any) => ({ text: String(l.text || ''), confidence: Number(l.confidence || 0) })) : [];
			return { text: String(parsed.text || ''), lines, avgConfidence: avg };
		} finally {
			try { fs.unlink(tmpPath, () => {}); } catch {}
		}
	}
}

// Factory to allow swapping engines in future
export function createOcrEngine(): OcrEngine {
	const engine = (process.env.OCR_ENGINE || 'paddle').toLowerCase();
	switch (engine) {
		case 'paddle':
		default:
			return new PaddleOcrEngine();
	}
}

// Back-compat wrappers (keep simple names):
export async function ocrRecognize(input: Buffer | string): Promise<string> {
	const engine = createOcrEngine();
	const buf = typeof input === 'string' ? Buffer.from(input, 'base64') : input;
	const res = await engine.recognize(buf);
	if ('status' in res && res.status === 'low_confidence') return '';
	const ok = res as OcrResult;
	return ok.text;
}

export async function getImageInput(urlOrBase64: string): Promise<Buffer | string> {
	// Minimal helper: pass through base64 or URL string unchanged (future-proof for fetch)
	return urlOrBase64;
}
