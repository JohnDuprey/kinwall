-- Read on every refresh, and chore_completions only grows. Points totals (GET /api/members) sum
-- each member's completions: without an index each member's sum read the whole table. The parent
-- badge's pending approvals read only what's waiting.
CREATE INDEX IF NOT EXISTS idx_chore_completions_member ON chore_completions(member_id, points_awarded);
CREATE INDEX IF NOT EXISTS idx_chore_completions_pending ON chore_completions(status) WHERE status = 'pending';
