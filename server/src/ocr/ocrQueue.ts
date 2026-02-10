import prisma from '../prismaClient';
import { extractOcrFromImage, sha256Hex } from './ocrService';
import { notifyUser } from '../events';

type Job = { noteImageId: number };

const queue: Job[] = [];
const enqueued = new Set<number>();
let running = false;

function log(msg: string, extra?: any) {
  try {
    // eslint-disable-next-line no-console
    console.info(`[OCR] ${msg}`, extra ?? '');
  } catch {}
}

function warn(msg: string, extra?: any) {
  try {
    // eslint-disable-next-line no-console
    console.warn(`[OCR] ${msg}`, extra ?? '');
  } catch {}
}

async function processOne(job: Job): Promise<void> {
  const id = Number(job.noteImageId);
  if (!Number.isFinite(id)) return;

  const img = await (prisma as any).noteImage.findUnique({ where: { id } });
  if (!img) return;

  const noteId = Number((img as any).noteId);

  // Don't OCR if already done for same hash.
  try {
    if (img.ocrStatus === 'done' && img.ocrSearchText) return;
  } catch {}

  const url = String(img.url || '');

  // Mark running
  try {
    await (prisma as any).noteImage.update({ where: { id }, data: { ocrStatus: 'running' } });
  } catch {}

  try {
    // Resolve image bytes for hashing/dedupe.
    const input = { kind: 'url' as const, url };
    const resolved = await (await import('./imageInput')).resolveImageBuffer(input);
    if (resolved.ok !== true) {
      warn(`resolve failed for image ${id}: ${resolved.code} ${resolved.message}`);
      await (prisma as any).noteImage.update({ where: { id }, data: { ocrStatus: 'error', ocrUpdatedAt: new Date() } });
      return;
    }

    const hash = sha256Hex(resolved.buffer);

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
        log(`reused OCR for image ${id}`);
        return;
      }
    } catch {}

    // Fresh OCR
    const outcome = await extractOcrFromImage({ kind: 'buffer', buffer: resolved.buffer }, { lang: 'en' });
    if (outcome.ok !== true) {
      warn(`failed for image ${id}: ${outcome.code} ${outcome.message}`);
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

    log(`done image ${id} avgConf=${String(structured.avgConfidence ?? '')}`);

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
    warn(`unexpected error for image ${id}`, e);
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
  // Fire-and-forget, never throw to request handlers.
  void drain();
}
