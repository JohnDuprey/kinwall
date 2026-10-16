-- To-do lists synced with Todoist or Google Tasks (tasks/sync.ts). New tables only: nothing existing
-- changes, and no rows are filled in.
-- task_accounts: a connected Todoist (a parent's personal API token) or Google Tasks sign-in. Kept
-- apart from the calendar accounts: Google Tasks has its own consent, and removing it must never
-- take the family's calendars with it. config is encrypted with the family key (row id as AAD).
CREATE TABLE task_accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL, -- 'todoist' | 'google'
  name TEXT NOT NULL, -- the account's email (or name), shown in Settings
  config TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One link per Kinwall list, to one Todoist project, Google Tasks list or Microsoft To Do list.
-- account_id NULL: imported from an export without its account (credentials never travel, like
-- calendars'), waiting for the family to connect that app again (app says which). synced_rev is the
-- list's items_rev (0074) after the last sync, so a change made in Kinwall is noticed even when the
-- quick sync after it didn't run. retry_after: a 429's back-off. The error columns work like
-- calendars' (0092, 0107): 'revoked' means only reconnecting the account fixes it, and
-- reconnect_notified_at is when the grown-ups were told (notify.ts), once per outage.
CREATE TABLE task_links (
  list_id TEXT PRIMARY KEY REFERENCES lists(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES task_accounts(id) ON DELETE CASCADE,
  app TEXT NOT NULL, -- 'todoist' | 'google' | 'microsoft'
  remote_id TEXT NOT NULL,
  remote_name TEXT NOT NULL,
  synced_rev INTEGER,
  last_synced_at TEXT,
  last_error TEXT,
  last_error_code TEXT,
  sync_failures INTEGER NOT NULL DEFAULT 0,
  retry_after TEXT,
  reconnect_notified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_links_account ON task_links(account_id);

-- Which outside task each item (or step) is, and the fields as both sides last agreed (JSON): a side
-- whose field differs from it changed that field. A step's row has parent_id, its item's id; its
-- outside task is a Todoist subtask, a Google Tasks subtask or a To Do checklist item. No foreign key
-- to list_items or steps on purpose: a row whose item is gone is how the next sync knows to delete
-- the outside task too. checked_at: when a task done on both sides was last looked up (Todoist only
-- lists open tasks, so one deleted while done is found a few at a time).
CREATE TABLE task_link_items (
  list_id TEXT NOT NULL REFERENCES task_links(list_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  base TEXT NOT NULL,
  parent_id TEXT,
  checked_at TEXT,
  PRIMARY KEY (list_id, item_id)
);
CREATE UNIQUE INDEX idx_task_link_items_remote ON task_link_items(list_id, remote_id);
