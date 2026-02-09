import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

export type ReminderDraft = {
  dueAtIso: string;
  offsetMinutes: number;
};

const OFFSET_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: 'At time of event', minutes: 0 },
  { label: '5 minutes before', minutes: 5 },
  { label: '10 minutes before', minutes: 10 },
  { label: '15 minutes before', minutes: 15 },
  { label: '30 minutes before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '2 hours before', minutes: 120 },
  { label: '1 day before', minutes: 24 * 60 },
];

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export default function ReminderPicker({
  onClose,
  onConfirm,
  onClear,
  initialDueAtIso,
  initialOffsetMinutes,
}: {
  onClose: () => void;
  onConfirm: (draft: ReminderDraft) => void;
  onClear?: () => void;
  initialDueAtIso?: string | null;
  initialOffsetMinutes?: number | null;
}) {
  const canPortal = typeof document !== 'undefined' && !!document.body;

  const initialDueAt = useMemo(() => {
    if (!initialDueAtIso) return null;
    const ms = Date.parse(String(initialDueAtIso));
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }, [initialDueAtIso]);

  const [dueAt, setDueAt] = useState<Date | null>(initialDueAt || new Date());
  const [offsetMinutes, setOffsetMinutes] = useState<number>(() => clampInt(initialOffsetMinutes, 0, 60 * 24 * 365, 30));

  const remindAt = useMemo(() => {
    if (!dueAt) return null;
    return new Date(dueAt.getTime() - (offsetMinutes * 60 * 1000));
  }, [dueAt, offsetMinutes]);

  function confirm() {
    if (!dueAt) return;
    onConfirm({ dueAtIso: dueAt.toISOString(), offsetMinutes });
  }

  const content = (
    <div className="reminder-backdrop" onClick={onClose}>
      <div className="reminder-popover reminder-popover--fancy" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="dialog-header">
          <strong>Reminder</strong>
          <button className="icon-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="reminder-grid">
          <div className="reminder-field">
            <div className="reminder-label">Due date & time</div>
            <DatePicker
              selected={dueAt}
              onChange={(d) => setDueAt(d as Date)}
              showTimeSelect
              timeIntervals={5}
              dateFormat="MMM d, yyyy h:mm aa"
              timeCaption="Time"
              className="image-url-input reminder-input"
              calendarClassName="reminder-calendar"
              popperClassName="reminder-popper"
              inline
            />
          </div>

          <div className="reminder-field">
            <div className="reminder-label">Remind me</div>
            <select
              className="image-url-input reminder-input"
              value={String(offsetMinutes)}
              onChange={(e) => setOffsetMinutes(clampInt(e.target.value, 0, 60 * 24 * 365, 30))}
            >
              {OFFSET_PRESETS.map((p) => (
                <option key={p.minutes} value={String(p.minutes)}>{p.label}</option>
              ))}
            </select>

            <div className="reminder-summary">
              {dueAt && remindAt ? (
                <>
                  <div><span className="muted">Due:</span> {dueAt.toLocaleString()}</div>
                  <div><span className="muted">Notify:</span> {remindAt.toLocaleString()}</div>
                </>
              ) : (
                <div className="muted">Pick a date and time.</div>
              )}
            </div>
          </div>
        </div>

        <div className="reminder-actions">
          <button className="btn" onClick={confirm} disabled={!dueAt}>Save</button>
          {onClear && (
            <button className="btn btn-danger" onClick={() => { try { onClear(); } finally { onClose(); } }}>Clear</button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );

  return canPortal ? createPortal(content, document.body) : content;
}
