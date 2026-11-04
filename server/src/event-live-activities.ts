import { activityPreferences } from './medicine-live-activities.ts';
import { eventPlans } from './routes/event-follows.ts';
import { pickEventActivity } from './event-activity-plan.ts';
import { nativePushConfigured, sendNativeLiveActivity } from './native-push.ts';
import { familyLang, words } from './i18n.ts';
import { sha256Hex } from './auth.ts';
import { unseal } from './crypto.ts';
import { swiftDate, unixSeconds } from './apns.ts';
import type { Env } from './env.ts';
export async function runEventLiveActivities(env: Env, now = new Date()) {
  if (!(await nativePushConfigured(env))) return;
  const db = env.DB;
  const { results: tokens } = await db
    .prepare(
      'SELECT t.*,COALESCE(k.owner,g.owner) AS owner,COALESCE(k.scope,g.scope) AS scope FROM live_activity_tokens t LEFT JOIN api_keys k ON k.id=t.api_key_id LEFT JOIN oauth_grants g ON g.id=t.oauth_grant_id',
    )
    .all<{
      id: string;
      device: string;
      kind: string;
      activity: string;
      token: string;
      preferences: string;
      state_hash: string;
      generation: number;
      owner: string | null;
      scope: string | null;
    }>();
  const { t } = words(await familyLang(db));
  for (const device of new Set(
    tokens
      .filter(
        (t) =>
          (t.kind === 'start' && activityPreferences(t.preferences).events) ||
          t.activity.startsWith('event:'),
      )
      .map((t) => t.device),
  )) {
    const rows = tokens.filter((t) => t.device === device),
      start = rows.find((t) => t.kind === 'start'),
      owner = start?.owner;
    const plans =
      owner && owner !== 'shared' && activityPreferences(start!.preferences).events
        ? await eventPlans(
            db,
            owner,
            new Date(now.getTime() - 8 * 3600000),
            new Date(now.getTime() + 48 * 3600000),
          )
        : [];
    const next = pickEventActivity(plans, now.getTime());
    const send = async (row: (typeof rows)[number], aps: Record<string, unknown>) => {
      const r = await sendNativeLiveActivity(
        env,
        await unseal(env, row.token, `live-activity-token:${row.id}`),
        { timestamp: unixSeconds(now.getTime()), ...aps },
      );
      if (r.gone)
        await db
          .prepare('DELETE FROM live_activity_tokens WHERE id=? AND token=?')
          .bind(row.id, row.token)
          .run();
      return r;
    };
    let blocked = false;
    for (const old of rows.filter(
      (r) =>
        r.kind === 'update' &&
        ((r.activity.startsWith('event:') && r.activity !== next?.activity) ||
          (next && r.activity.startsWith(`leaveBy:${next.eventId}@`))),
    )) {
      const r = await send(old, {
        event: 'end',
        'dismissal-date': unixSeconds(now.getTime()),
        'content-state': { title: '', detail: null, date: null, count: 0, done: true },
      });
      if (r.ok || r.gone) {
        if (start && old.activity.startsWith('event:') && next) {
          const key = `ela:${await sha256Hex(`${device}:${start.generation}:${old.activity}`)}`;
          await db.prepare('DELETE FROM sent_notifications WHERE key=?').bind(key).run();
        }
        await db
          .prepare('DELETE FROM live_activity_tokens WHERE id=? AND token=?')
          .bind(old.id, old.token)
          .run();
      } else blocked = true;
    }
    if (!next || !start || blocked) continue;
    const headline =
      next.stage === 'end'
        ? t('Ends in')
        : next.stage === 'start'
          ? t('Starts in')
          : next.stage === 'prep'
            ? t('Start prep in')
            : t('Leave in');
    const content = {
      title: next.title,
      detail: headline,
      date: swiftDate(Date.parse(next.at)),
      count: 0,
      done: false,
      event: next,
    };
    const hash = await sha256Hex(JSON.stringify(content)),
      current = rows.find((r) => r.kind === 'update' && r.activity === next.activity);
    if (current) {
      if (current.state_hash === hash) continue;
      const r = await send(current, {
        event: 'update',
        'content-state': content,
        'stale-date': unixSeconds(Date.parse(next.endsAt)),
      });
      if (r.ok)
        await db
          .prepare('UPDATE live_activity_tokens SET state_hash=?,ends_at=? WHERE id=? AND token=?')
          .bind(hash, next.endsAt, current.id, current.token)
          .run();
    } else {
      const key = `ela:${await sha256Hex(`${device}:${start.generation}:${next.activity}`)}`;
      const claimed = await db
        .prepare('INSERT INTO sent_notifications(key,sent_at) VALUES(?,?) ON CONFLICT(key) DO NOTHING')
        .bind(key, now.toISOString())
        .run();
      if (!claimed.meta.changes) continue;
      const r = await send(start, {
        event: 'start',
        'attributes-type': 'KinwallActivityAttributes',
        attributes: { kind: 'event', name: 'Event', eventId: next.eventId, activity: next.activity },
        'content-state': content,
        'stale-date': unixSeconds(Date.parse(next.endsAt)),
        alert: { title: next.title, body: headline },
      });
      if (!r.ok && !r.gone) await db.prepare('DELETE FROM sent_notifications WHERE key=?').bind(key).run();
    }
  }
}
