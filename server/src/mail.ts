import nodemailer from 'nodemailer';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port) return null;

  const secure = port === 465; // common

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  } as any);

  return transporter;
}

export async function sendInviteEmail(to: string, token: string) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('SMTP not configured');

  const from = process.env.INVITE_FROM || process.env.SMTP_USER || `no-reply@freemannotes.local`;
  // Prefer an explicit production URL when present so invite links point to the public app host.
  // `PRODUCTION_URL` can be a hostname or a full URL (e.g. "notes.mydomain.com" or "https://notes.mydomain.com").
  const rawBase = process.env.PRODUCTION_URL || process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:4000';
  // Ensure the base includes a protocol; if only a hostname was provided, default to https in production and http otherwise.
  let base = rawBase;
  if (!/^https?:\/\//i.test(base)) {
    const defaultProto = process.env.NODE_ENV === 'production' ? 'https://' : 'http://';
    base = `${defaultProto}${base}`;
  }
  const link = `${base.replace(/\/$/, '')}/?invite=${encodeURIComponent(token)}`;

  const subject = 'You were invited to join FreemanNotes';
  const text = `You were invited to join FreemanNotes. Click the link to register: ${link}`;
  const html = `<p>You were invited to join <strong>FreemanNotes</strong>.</p>
    <p><a href="${link}">Click here to register</a></p>
    <p>If the link doesn't work, use this invite token: <code>${token}</code></p>`;

  // Use explicit envelope.from set to SMTP_USER when available so the SMTP MAIL FROM
  // matches the authenticated account (avoids provider EENVELOPE / 530 errors).
  const envelopeFrom = process.env.SMTP_USER || from;
  const info = await transporter.sendMail({ from, to, subject, text, html, envelope: { from: envelopeFrom, to } as any });
  return info;
}
