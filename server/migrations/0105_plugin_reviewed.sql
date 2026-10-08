-- Plugins installed from the reviewed catalog (routes/plugins.ts). Once reviewed, a plugin only ever
-- installs or updates to a catalog version checked against its hash: one taken off the catalog can't
-- fall back to its repo's latest release. Additive: existing rows start at 0 and are marked the next
-- time their repo is seen in the catalog.
ALTER TABLE plugins ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0;
