-- Daily check-in: a member read their day's snapshot to the end. One per member per household day;
-- the points it earned are in point_entries (reason 'check_in', ref = date, id 'checkin:<member>:<date>').
CREATE TABLE check_ins (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  points INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (member_id, date)
);
