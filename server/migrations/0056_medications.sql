-- Medication reminders (routes/medications.ts). Health data: everything that says what or when is
-- sealed with the family's key (crypto.ts seal), so only who and which day stay plain.
-- data: JSON { name, dose, times: ["HH:MM"], days: [0-6] }, aad '<id>:data'.
CREATE TABLE medications (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_medications_member ON medications(member_id);

-- One row per medicine per household day: log is JSON { "HH:MM": { status, at, by, snoozedUntil } },
-- sealed (aad '<medication_id>:<date>:log'). Deleting a medicine deletes its log.
CREATE TABLE medication_log (
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  log TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (medication_id, date)
);
