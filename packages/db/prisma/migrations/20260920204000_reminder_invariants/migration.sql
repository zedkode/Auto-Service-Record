-- One LIVE reminder per source. Completed, dismissed and cancelled reminders are excluded
-- so history is retained while a duplicate active reminder is impossible — the scheduler
-- upserts against this (ARCHITECTURE.md §8).
CREATE UNIQUE INDEX IF NOT EXISTS reminders_live_source_uk
  ON reminders (workspace_id, source_type, source_id)
  WHERE status IN ('SCHEDULED', 'DUE', 'SENT', 'SNOOZED') AND source_id IS NOT NULL;

-- The scheduler's hot path: find reminders that have become due.
CREATE INDEX IF NOT EXISTS reminders_pending_due_idx
  ON reminders (due_on)
  WHERE status IN ('SCHEDULED', 'SNOOZED');

-- Notification centre: unread badge and list.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
