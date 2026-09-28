-- Household contacts are independent of members and calendar categories.
CREATE TABLE contact_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'service', 'organization', 'place')),
  name TEXT NOT NULL,
  organization TEXT,
  relationship TEXT,
  title TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  emergency INTEGER NOT NULL DEFAULT 0,
  phones TEXT NOT NULL DEFAULT '[]',
  emails TEXT NOT NULL DEFAULT '[]',
  addresses TEXT NOT NULL DEFAULT '[]',
  websites TEXT NOT NULL DEFAULT '[]',
  dates TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  category_ids TEXT NOT NULL DEFAULT '[]',
  private_fields TEXT NOT NULL DEFAULT '[]',
  given_name TEXT,
  family_name TEXT,
  nickname TEXT,
  member_ids TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  service_hours TEXT,
  service_area TEXT,
  always_open INTEGER NOT NULL DEFAULT 0,
  wall_visible INTEGER NOT NULL DEFAULT 0,
  emergency_visible INTEGER NOT NULL DEFAULT 0,
  phone_visible_on_wall INTEGER NOT NULL DEFAULT 0,
  address_visible_on_wall INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('household', 'adults', 'selected_members', 'private')),
  selected_member_ids TEXT NOT NULL DEFAULT '[]',
  source_metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX contacts_name_idx ON contacts(name COLLATE NOCASE);
CREATE INDEX contacts_kind_idx ON contacts(kind);

INSERT OR IGNORE INTO contact_categories (id, name, color, sort, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000001','Emergency services','#E26D5A',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000002','Medical','#7AB8FF',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000003','Veterinary','#7ED9A6',2,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000004','Childcare','#FFD166',3,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000005','Family','#FF9E7A',4,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000006','Friends','#B39DFF',5,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000007','Neighbors','#C9A7FF',6,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000008','School','#F5A65B',7,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000009','Work','#7AB8FF',8,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000010','Home services','#F5A65B',9,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000011','Transportation','#7ED9A6',10,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000012','Organizations','#B39DFF',11,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
 ('00000000-0000-4000-8000-000000000013','Other','#A0A6B0',12,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
