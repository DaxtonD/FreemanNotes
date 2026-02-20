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

function getAppBaseUrl(): string {
  const rawBase = process.env.PRODUCTION_URL || process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:4000';
  let base = rawBase;
  if (!/^https?:\/\//i.test(base)) {
    const defaultProto = process.env.NODE_ENV === 'production' ? 'https://' : 'http://';
    base = `${defaultProto}${base}`;
  }
  return base.replace(/\/$/, '');
}

export async function sendInviteEmail(to: string, token: string) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('SMTP not configured');

  const from = process.env.INVITE_FROM || process.env.SMTP_USER || `no-reply@freemannotes.local`;
  const link = `${getAppBaseUrl()}/?invite=${encodeURIComponent(token)}`;

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

export async function sendPasswordResetEmail(to: string, token: string) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('SMTP not configured');

  const from = process.env.INVITE_FROM || process.env.SMTP_USER || `no-reply@freemannotes.local`;
  const link = `${getAppBaseUrl()}/?reset=${encodeURIComponent(token)}`;

  const subject = 'Reset your FreemanNotes password';
  const text = `A password reset was requested for your FreemanNotes account. Open this link to choose a new password: ${link}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<p>A password reset was requested for your <strong>FreemanNotes</strong> account.</p>
    <p><a href="${link}">Reset your password</a></p>
    <p>If you did not request this, you can safely ignore this email.</p>`;

  const envelopeFrom = process.env.SMTP_USER || from;
  const info = await transporter.sendMail({ from, to, subject, text, html, envelope: { from: envelopeFrom, to } as any });
  return info;
}
