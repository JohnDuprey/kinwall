// The family's default calendar for new events: the in-app event sheet, the phones' share sheets
// (GET /api/calendars marks it `default`), and POST /api/events, MCP create_event and /api/share
// when no calendar is named. A parent picks it (settings.defaultCalendarId); while that's unset,
// gone, read-only or off, Kinwall picks: the family's own Kinwall calendar before ones fed from
// elsewhere (a Home Assistant sync, like a meal kit's deliveries, or a school feed), then any
// writable calendar, by name. Tested in test/default-calendar.test.ts.
import type { KinwallDb } from './db.ts';

export type DefaultCandidate = {
  id: string;
  name: string;
  kind: string;
  writable: number | boolean;
  enabled: number | boolean;
  placeholder: number | boolean; // an imported calendar waiting for its account to reconnect
  fed: number | boolean; // a local calendar with events an automation syncs in
};

export function pickDefaultCalendar(cals: DefaultCandidate[], chosen: string | null | undefined): string | null {
  const open = cals.filter((c) => c.writable && c.enabled && !c.placeholder).sort((a, b) => a.name.localeCompare(b.name));
  return (
    open.find((c) => c.id === chosen) ??
    open.find((c) => c.kind === 'local' && !c.fed) ??
    open.find((c) => !c.fed) ??
    open[0]
  )?.id ?? null;
}

export async function defaultCalendarId(db: KinwallDb): Promise<string | null> {
  const [cals, setting] = await db.batch<unknown>([
    db.prepare(
      `SELECT id, name, kind, writable, enabled, (kind <> 'local' AND config = '') AS placeholder,
              EXISTS (SELECT 1 FROM events e WHERE e.calendar_id = calendars.id AND e.sync_source IS NOT NULL) AS fed
         FROM calendars`,
    ),
    db.prepare("SELECT value FROM settings WHERE key = 'defaultCalendarId'"),
  ]);
  return pickDefaultCalendar(cals.results as DefaultCandidate[], (setting.results[0] as { value: string } | undefined)?.value || null);
}
