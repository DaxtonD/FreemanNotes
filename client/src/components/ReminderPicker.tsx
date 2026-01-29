import React, { useState } from "react";

export default function ReminderPicker({ onClose, onSet }: { onClose: () => void; onSet: (iso?: string | null) => void }) {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const [date, setDate] = useState<string>(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  const [time, setTime] = useState<string>(`${pad(now.getHours())}:${pad(now.getMinutes())}`);

  function confirm() {
    const iso = new Date(`${date}T${time}:00`).toISOString();
    onSet(iso);
  }

  return (
    <div className="reminder-backdrop" onClick={onClose}>
      <div className="reminder-popover" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <strong>Set reminder</strong>
          <button className="icon-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          <input type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={confirm}>Set</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
