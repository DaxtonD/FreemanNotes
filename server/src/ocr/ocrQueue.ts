import prisma from '../prismaClient';
import { extractOcrFromImage, sha256Hex } from './ocrService';
import { notifyUser } from '../events';
import { ocrLog, summarizeOcrInputUrl, tailString } from './ocrLog';

type Job = { noteImageId: number };

const queue: Job[] = [];
const enqueued = new Set<number>();
let running = false;

async function processOne(job: Job): Promise<void> {
  const id = Number(job.noteImageId);
  if (!Number.isFinite(id)) return;

  const tJobStart = Date.now();

  const img = await (prisma as any).noteImage.findUnique({ where: { id } });
  if (!img) return;

  const noteId = Number((img as any).noteId);

  // Don't OCR if already done for same hash.
  try {
    if (img.ocrStatus === 'done' && img.ocrSearchText) return;
  } catch {}

  const url = String(img.url || '');
  const urlSummary = summarizeOcrInputUrl(url);
  ocrLog('info', 'job start', { noteImageId: id, noteId, url: urlSummary.summary, status: (img as any).ocrStatus });

  // Mark running
  try {
    await (prisma as any).noteImage.update({ where: { id }, data: { ocrStatus: 'running' } });
  } catch {}

  try {
    // Resolve image bytes for hashing/dedupe.
    const input = { kind: 'url' as const, url };
    const resolved = await (await import('./imageInput')).resolveImageBuffer(input);
    if (resolved.ok !== true) {
      ocrLog('warn', 'resolve failed', { noteImageId: id, code: resolved.code, message: resolved.message, url: urlSummary.summary });
      await (prisma as any).noteImage.update({ where: { id }, data: { ocrStatus: 'error', ocrUpdatedAt: new Date() } });
      return;
    }

    const hash = sha256Hex(resolved.buffer);
    ocrLog('debug', 'resolved bytes', { noteImageId: id, bytes: resolved.buffer.length, sha256: hash.slice(0, 16), url: urlSummary.summary });

    // Reuse any existing OCR result by hash.
    try {
      const existing = await (prisma as any).noteImage.findFirst({
        where: {
          ocrHash: hash,
          ocrSearchText: { not: null },
          ocrStatus: 'done',
        },
        select: {
          ocrText: true,
          ocrSearchText: true,
          ocrDataJson: true,
          ocrAvgConfidence: true,
          ocrLang: true,
        },
      });

      if (existing) {
        await (prisma as any).noteImage.update({
          where: { id },
          data: {
            ocrHash: hash,
            ocrText: existing.ocrText,
            ocrSearchText: existing.ocrSearchText,
            ocrDataJson: existing.ocrDataJson,
            ocrAvgConfidence: existing.ocrAvgConfidence,
            ocrLang: existing.ocrLang,
            ocrStatus: 'done',
            ocrUpdatedAt: new Date(),
          },
        });
        ocrLog('info', 'reused OCR by hash', { noteImageId: id, sha256: hash.slice(0, 16) });
        return;
      }
    } catch {}

    // Fresh OCR
    const outcome = await extractOcrFromImage({ kind: 'buffer', buffer: resolved.buffer }, { lang: 'en' });
    if (outcome.ok !== true) {
      ocrLog('warn', 'engine failed', { noteImageId: id, code: outcome.code, message: outcome.message, cause: tailString(outcome.cause, 800) });
      await (prisma as any).noteImage.update({
        where: { id },
        data: {
          ocrHash: hash,
          ocrStatus: outcome.code === 'PYTHON_NOT_FOUND' || outcome.code === 'PYTHON_DEPS_MISSING' ? 'skipped' : 'error',
          ocrUpdatedAt: new Date(),
        },
      });
      return;
    }

    const structured = outcome.result.structured;

    await (prisma as any).noteImage.update({
      where: { id },
      data: {
        ocrHash: hash,
        ocrText: outcome.result.rawText,
        ocrSearchText: outcome.result.searchText,
        ocrDataJson: JSON.stringify(structured),
        ocrAvgConfidence: typeof structured.avgConfidence === 'number' ? structured.avgConfidence : null,
        ocrLang: structured.lang,
        ocrStatus: 'done',
        ocrUpdatedAt: new Date(),
      },
    });

    ocrLog('info', 'job done', {
      noteImageId: id,
      sha256: hash.slice(0, 16),
      bytes: resolved.buffer.length,
      engineMs: structured.durationMs,
      avgConfidence: structured.avgConfidence,
      lines: Array.isArray(structured.lines) ? structured.lines.length : undefined,
      totalMs: Date.now() - tJobStart,
    });

    // Wake up clients so global search picks up OCR text.
    try {
      const note = await prisma.note.findUnique({ where: { id: noteId }, select: { ownerId: true } });
      if (note) {
        const collabs = await prisma.collaborator.findMany({ where: { noteId }, select: { userId: true } });
        const participantIds = Array.from(new Set<number>([
          Number(note.ownerId),
          ...collabs.map((c: any) => Number(c.userId)).filter((n: any) => Number.isFinite(n)),
        ]));
        for (const uid of participantIds) {
          try { notifyUser(uid, 'note-images-changed', { noteId }); } catch {}
        }
      }
    } catch {}
  } catch (e) {
    ocrLog('error', 'unexpected error', { noteImageId: id, err: tailString(e, 1200), totalMs: Date.now() - tJobStart });
    try {
      await (prisma as any).noteImage.update({ where: { id }, data: { ocrStatus: 'error', ocrUpdatedAt: new Date() } });
    } catch {}
  }
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      enqueued.delete(job.noteImageId);
      await processOne(job);
    }
  } finally {
    running = false;
  }
}

export function enqueueNoteImageOcr(noteImageId: number): void {
  const id = Number(noteImageId);
  if (!Number.isFinite(id)) return;
  if (enqueued.has(id)) return;
  enqueued.add(id);
  queue.push({ noteImageId: id });
  ocrLog('debug', 'enqueued', { noteImageId: id, queueLen: queue.length });
  // Fire-and-forget, never throw to request handlers.
  void drain();
}
