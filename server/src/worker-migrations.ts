// Every migration, bundled as text by wrangler (.sql files are Text modules). Keep in sync with
// server/migrations/ - test/migrate.test.ts fails if a file is missing here.
import type { Migration } from './migrate.ts';
import m0001 from '../migrations/0001_init.sql';
import m0002 from '../migrations/0002_security.sql';
import m0003 from '../migrations/0003_ics_fingerprint.sql';
import m0004 from '../migrations/0004_pairings.sql';
import m0005 from '../migrations/0005_passkeys.sql';
import m0006 from '../migrations/0006_event_member_overrides.sql';
import m0007 from '../migrations/0007_series_member_overrides.sql';
import m0008 from '../migrations/0008_calendar_multi_member.sql';
import m0009 from '../migrations/0009_calendar_kind_from_account.sql';
import m0010 from '../migrations/0010_lists.sql';
import m0011 from '../migrations/0011_categories.sql';
import m0012 from '../migrations/0012_sort_order.sql';
import m0013 from '../migrations/0013_push.sql';
import m0014 from '../migrations/0014_oauth.sql';
import m0015 from '../migrations/0015_pairings_ip.sql';
import m0016 from '../migrations/0016_host_events_rate_limits.sql';
import m0017 from '../migrations/0017_recovery_codes.sql';
import m0018 from '../migrations/0018_list_item_event.sql';
import m0019 from '../migrations/0019_travel_time.sql';
import m0020 from '../migrations/0020_points_awarded.sql';
import m0021 from '../migrations/0021_list_item_priority_steps.sql';
import m0022 from '../migrations/0022_notifications.sql';
import m0023 from '../migrations/0023_list_sort_priority_levels.sql';
import m0024 from '../migrations/0024_notes.sql';
import m0025 from '../migrations/0025_stickers.sql';
import m0026 from '../migrations/0026_snapshot.sql';
import m0027 from '../migrations/0027_chore_checklist.sql';
import m0028 from '../migrations/0028_photos.sql';

export const MIGRATIONS: Migration[] = [
  { name: '0001_init.sql', sql: m0001 },
  { name: '0002_security.sql', sql: m0002 },
  { name: '0003_ics_fingerprint.sql', sql: m0003 },
  { name: '0004_pairings.sql', sql: m0004 },
  { name: '0005_passkeys.sql', sql: m0005 },
  { name: '0006_event_member_overrides.sql', sql: m0006 },
  { name: '0007_series_member_overrides.sql', sql: m0007 },
  { name: '0008_calendar_multi_member.sql', sql: m0008 },
  { name: '0009_calendar_kind_from_account.sql', sql: m0009 },
  { name: '0010_lists.sql', sql: m0010 },
  { name: '0011_categories.sql', sql: m0011 },
  { name: '0012_sort_order.sql', sql: m0012 },
  { name: '0013_push.sql', sql: m0013 },
  { name: '0014_oauth.sql', sql: m0014 },
  { name: '0015_pairings_ip.sql', sql: m0015 },
  { name: '0016_host_events_rate_limits.sql', sql: m0016 },
  { name: '0017_recovery_codes.sql', sql: m0017 },
  { name: '0018_list_item_event.sql', sql: m0018 },
  { name: '0019_travel_time.sql', sql: m0019 },
  { name: '0020_points_awarded.sql', sql: m0020 },
  { name: '0021_list_item_priority_steps.sql', sql: m0021 },
  { name: '0022_notifications.sql', sql: m0022 },
  { name: '0023_list_sort_priority_levels.sql', sql: m0023 },
  { name: '0024_notes.sql', sql: m0024 },
  { name: '0025_stickers.sql', sql: m0025 },
  { name: '0026_snapshot.sql', sql: m0026 },
  { name: '0027_chore_checklist.sql', sql: m0027 },
  { name: '0028_photos.sql', sql: m0028 },
];
