import React from "react";

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-item active">Notes</div>
        <div className="sidebar-item">Reminders</div>
        <div className="sidebar-item">Inspiration</div>
        <hr />
        <div className="sidebar-item">Edit labels</div>
        <div className="sidebar-item">Archive</div>
        <div className="sidebar-item">Bin</div>
      </div>
    </aside>
  );
}
