// Legacy module retained for compatibility.
// Reminder polling has been replaced by BullMQ + Redis delayed jobs.
export function startReminderPushJob(): () => void {
  console.warn('[reminderPushJob] deprecated: polling disabled; use BullMQ reminder worker');
  return () => {};
}
