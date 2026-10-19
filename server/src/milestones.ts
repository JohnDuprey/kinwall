// Milestone progress uses the same earned sources as profiles, never spendable balances.
import type { Context } from 'hono';
import type { KinwallDb } from './db.ts';
import type { Env } from './env.ts';
import { emit } from './bus.ts';
import { notifyChoreApproval } from './notify.ts';

// Stable chore/day keys survive undo/re-tick (which can replace a completion's row id).
export const MILESTONE_SOURCES = `SELECT member_id, 'chore:' || chore_id || ':' || date AS source, COALESCE(points_awarded, 0) AS points, 1 AS chores FROM chore_completions WHERE status = 'approved'
 UNION ALL SELECT member_id, 'checkin:' || date, points, 0 FROM check_ins
 UNION ALL SELECT member_id, 'bonus:' || id, amount, 0 FROM point_entries WHERE reason = 'bonus'`;

export const MILESTONE_PROGRESS = `(SELECT COALESCE(SUM(CASE m.metric WHEN 'points' THEN s.points ELSE s.chores END), 0)
 FROM (${MILESTONE_SOURCES}) s WHERE s.member_id = e.member_id AND s.source NOT IN (SELECT value FROM json_each(e.baseline)))`;

export type MilestoneMember = { memberId: string; startedAt: string; progress: number; earnedAt: string | null; givenAt: string | null };
export type Milestone = { id: string; title: string; emoji: string | null; reward: string; metric: 'points' | 'chores'; target: number; active: boolean; createdAt: string; members: MilestoneMember[] };
export type MilestoneRow = { id: string; title: string; emoji: string | null; reward: string; metric: 'points' | 'chores'; target: number; active: number; created_at: string };
export type EnrollmentRow = { milestone_id: string; member_id: string; started_at: string; baseline: string; paused_sources: string | null; paused_progress: number | null; earned_at: string | null; given_at: string | null };

export async function listMilestones(db: KinwallDb, memberId?: string, archived = false): Promise<Milestone[]> {
  const [definitions, enrollments] = await db.batch<unknown>([
    db.prepare(`SELECT * FROM reward_milestones ${archived ? '' : 'WHERE active = 1'} ORDER BY created_at, id`),
    db.prepare(`SELECT e.*, ${MILESTONE_PROGRESS} AS progress FROM reward_milestone_members e JOIN reward_milestones m ON m.id = e.milestone_id ${memberId ? 'WHERE e.member_id = ?' : ''}`).bind(...(memberId ? [memberId] : [])),
  ]);
  return (definitions.results as MilestoneRow[]).map(m => ({
    id: m.id, title: m.title, emoji: m.emoji, reward: m.reward, metric: m.metric, target: m.target, active: !!m.active, createdAt: m.created_at,
    members: (enrollments.results as (EnrollmentRow & { progress: number })[]).filter(e => e.milestone_id === m.id).map(e => ({ memberId: e.member_id, startedAt: e.started_at, progress: e.earned_at ? m.target : Math.max(0, Math.min(m.target, !m.active && e.paused_progress !== null ? e.paused_progress : e.progress)), earnedAt: e.earned_at, givenAt: e.given_at })),
  })).filter(m => m.members.length > 0);
}

/** Conditional UPDATE is the award record and the deduplication gate, even for concurrent writers.
 * Reconcile only after successful writes, never from a GET. Corrections don't revoke earned awards. */
export async function reconcileMilestones(c: Context<{ Bindings: Env }>): Promise<void> {
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(`UPDATE reward_milestone_members AS e SET earned_at = ?
    WHERE earned_at IS NULL
      AND COALESCE((SELECT value FROM settings WHERE key = 'rewardsEnabled'), 'true') = 'true'
      AND COALESCE((SELECT json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.chores') FROM settings WHERE key = 'features'), 1) <> 0
      AND EXISTS (SELECT 1 FROM reward_milestones m WHERE m.id = e.milestone_id AND m.active = 1 AND ${MILESTONE_PROGRESS} >= m.target)
    RETURNING milestone_id, member_id`).bind(now).all<{ milestone_id: string; member_id: string }>();
  for (const e of result.results) {
    const m = await c.env.DB.prepare('SELECT title, emoji, reward FROM reward_milestones WHERE id = ?').bind(e.milestone_id).first<{ title: string; emoji: string | null; reward: string }>();
    if (!m) continue;
    emit(c, 'reward.milestone.earned', { id: e.milestone_id, memberId: e.member_id, title: m.title, reward: m.reward });
    let ctx;
    try { ctx = c.executionCtx; } catch { /* Node has no execution context. */ }
    notifyChoreApproval(c.env, ctx, { owner: e.member_id }, `milestone:${e.milestone_id}:${e.member_id}`, {
      text: () => ({ title: `${m.emoji ?? '🎁'} ${m.title}`, body: m.reward }),
      url: `/#/rewards/${e.member_id}`, memberIds: [e.member_id],
    });
  }
}
