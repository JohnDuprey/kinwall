-- Each member's chore and bonus points per day, built once from existing history and kept in the
-- same transaction as every completion or bonus change (including cascading deletes), so today's
-- and this week's points read a week of daily rows instead of the week's completions. Source rows
-- are untouched.
CREATE TABLE member_daily_points (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, date)
);
CREATE INDEX idx_member_daily_points_date ON member_daily_points(date);
INSERT INTO member_daily_points(member_id, date, points)
SELECT member_id, date, SUM(points) FROM (
  SELECT member_id, date, coalesce(points_awarded, 0) AS points FROM chore_completions WHERE member_id IS NOT NULL
  UNION ALL
  SELECT member_id, ref, amount FROM point_entries WHERE reason = 'bonus' AND ref IS NOT NULL
) GROUP BY member_id, date;

CREATE TRIGGER daily_points_chore_insert AFTER INSERT ON chore_completions WHEN new.member_id IS NOT NULL BEGIN
  INSERT INTO member_daily_points(member_id, date, points) VALUES (new.member_id, new.date, coalesce(new.points_awarded, 0))
  ON CONFLICT(member_id, date) DO UPDATE SET points = points + excluded.points;
END;
CREATE TRIGGER daily_points_chore_delete AFTER DELETE ON chore_completions WHEN old.member_id IS NOT NULL BEGIN
  UPDATE member_daily_points SET points = points - coalesce(old.points_awarded, 0) WHERE member_id = old.member_id AND date = old.date;
END;
CREATE TRIGGER daily_points_chore_update AFTER UPDATE OF member_id, date, points_awarded ON chore_completions BEGIN
  UPDATE member_daily_points SET points = points - coalesce(old.points_awarded, 0) WHERE old.member_id IS NOT NULL AND member_id = old.member_id AND date = old.date;
  INSERT INTO member_daily_points(member_id, date, points) SELECT new.member_id, new.date, coalesce(new.points_awarded, 0) WHERE new.member_id IS NOT NULL
  ON CONFLICT(member_id, date) DO UPDATE SET points = points + excluded.points;
END;
CREATE TRIGGER daily_points_bonus_insert AFTER INSERT ON point_entries WHEN new.reason = 'bonus' AND new.ref IS NOT NULL BEGIN
  INSERT INTO member_daily_points(member_id, date, points) VALUES (new.member_id, new.ref, new.amount)
  ON CONFLICT(member_id, date) DO UPDATE SET points = points + excluded.points;
END;
CREATE TRIGGER daily_points_bonus_delete AFTER DELETE ON point_entries WHEN old.reason = 'bonus' AND old.ref IS NOT NULL BEGIN
  UPDATE member_daily_points SET points = points - old.amount WHERE member_id = old.member_id AND date = old.ref;
END;
CREATE TRIGGER daily_points_bonus_update AFTER UPDATE OF member_id, amount, reason, ref ON point_entries BEGIN
  UPDATE member_daily_points SET points = points - old.amount WHERE old.reason = 'bonus' AND old.ref IS NOT NULL AND member_id = old.member_id AND date = old.ref;
  INSERT INTO member_daily_points(member_id, date, points) SELECT new.member_id, new.ref, new.amount WHERE new.reason = 'bonus' AND new.ref IS NOT NULL
  ON CONFLICT(member_id, date) DO UPDATE SET points = points + excluded.points;
END;
