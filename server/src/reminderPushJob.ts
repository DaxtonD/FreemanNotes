import webpush from 'web-push';

function getVapidConfig(): { enabled: boolean; reason?: string } {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:admin@localhost').trim();
  if (!publicKey || !privateKey) {
    return { enabled: false, reason: 'Missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY' };
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { enabled: true };
  } catch (err) {
    return { enabled: false, reason: String(err) };
  }
}

function formatDue(d: Date | null): string {
  if (!d) return '';
  try {
    return d.toLocaleString();
  } catch {
    return d.toISOString();
  }
}

export function startReminderPushJob(prisma: any, opts?: { intervalMs?: number; maxNotesPerTick?: number }) {
  const intervalMs = typeof opts?.intervalMs === 'number' ? opts!.intervalMs! : 30_000;
  const maxNotesPerTick = typeof opts?.maxNotesPerTick === 'number' ? opts!.maxNotesPerTick! : 50;

  let warnedMissing = false;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;

    try {
      const cfg = getVapidConfig();
      if (!cfg.enabled) {
        if (!warnedMissing) {
          warnedMissing = true;
          console.warn('[push] Web Push disabled:', cfg.reason || 'not configured');
        }
        return;
      }

      const now = new Date();

      const dueNotes = await prisma.note.findMany({
        where: {
          reminderAt: { not: null, lte: now },
          reminderNotifiedAt: null,
          reminderDueAt: { not: null },
          trashedAt: null,
          archived: false,
        },
        select: {
          id: true,
          title: true,
          reminderDueAt: true,
          ownerId: true,
          collaborators: { select: { userId: true } },
        },
        orderBy: [{ reminderAt: 'asc' }],
        take: maxNotesPerTick,
      });

      if (!dueNotes.length) return;

      // Gather all target userIds.
      const noteTargets = dueNotes.map((n: any) => {
        const userIds = new Set<number>();
        userIds.add(Number(n.ownerId));
        for (const c of (n.collaborators || [])) {
          const uid = Number(c.userId);
          if (Number.isFinite(uid)) userIds.add(uid);
        }
        return { note: n, userIds: Array.from(userIds) };
      });

      const allUserIds = Array.from(new Set<number>(noteTargets.flatMap(x => x.userIds)));
      const subs = await prisma.pushSubscription.findMany({
        where: { userId: { in: allUserIds } },
        select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
      });

      const subsByUser = new Map<number, any[]>();
      for (const s of subs) {
        const uid = Number(s.userId);
        if (!subsByUser.has(uid)) subsByUser.set(uid, []);
        subsByUser.get(uid)!.push(s);
      }

      for (const { note, userIds } of noteTargets) {
        const title = String(note.title || 'Reminder');
        const body = note.reminderDueAt ? `Due: ${formatDue(new Date(note.reminderDueAt))}` : 'Reminder';
        const payload = {
          type: 'reminder',
          title,
          body,
          url: '/',
          noteId: Number(note.id),
        };

        for (const uid of userIds) {
          const userSubs = subsByUser.get(uid) || [];
          for (const s of userSubs) {
            const id = Number(s.id);
            try {
              await webpush.sendNotification(
                {
                  endpoint: String(s.endpoint),
                  keys: { p256dh: String(s.p256dh), auth: String(s.auth) },
                } as any,
                JSON.stringify(payload),
                { TTL: 60 * 60, urgency: 'high' as any }
              );
            } catch (err: any) {
              const status = Number(err?.statusCode || err?.status || 0);
              if (status === 404 || status === 410) {
                try { await prisma.pushSubscription.delete({ where: { id } }); } catch {}
              }
            }
          }
        }

        // Mark note as notified once we've attempted delivery.
        try {
          await prisma.note.update({ where: { id: Number(note.id) }, data: { reminderNotifiedAt: now } });
        } catch {}
      }
    } catch (err) {
      console.warn('[push] Reminder tick error:', err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  // Fire once shortly after start.
  setTimeout(() => { tick(); }, 3_000);

  return () => {
    try { clearInterval(timer); } catch {}
  };
}
