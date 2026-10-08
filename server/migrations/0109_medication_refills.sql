-- Refill places (routes/medication-refills.ts): where a family asks for medicine refills, shared by
-- the medicines that point to them (medications.data refill.contactId). Health data: everything but the
-- id and timestamps is one sealed JSON (crypto.ts seal, aad '<id>:refill'): its name, app, website,
-- phone number, phone-menu steps, dial digits and message script.
CREATE TABLE medication_refill_contacts (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
