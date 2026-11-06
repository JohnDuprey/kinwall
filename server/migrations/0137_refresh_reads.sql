-- Build derived totals once from existing history, then maintain them in the same transaction
-- as every ledger change (including imports and cascading deletes). Source rows are untouched.
CREATE TABLE member_point_totals (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  chore_earned INTEGER NOT NULL DEFAULT 0,
  ledger_earned INTEGER NOT NULL DEFAULT 0,
  ledger_spent INTEGER NOT NULL DEFAULT 0
);
INSERT INTO member_point_totals(member_id, chore_earned, ledger_earned, ledger_spent)
SELECT m.id,
 (SELECT coalesce(sum(points_awarded),0) FROM chore_completions WHERE member_id=m.id),
 (SELECT coalesce(sum(amount),0) FROM point_entries WHERE member_id=m.id AND amount>0 AND reason<>'reward_refund'),
 (SELECT coalesce(-sum(amount),0) FROM point_entries WHERE member_id=m.id AND (amount<0 OR reason='reward_refund'))
FROM members m;

CREATE TRIGGER totals_chore_earned_insert AFTER INSERT ON chore_completions BEGIN
  INSERT INTO member_point_totals(member_id,chore_earned) SELECT new.member_id, coalesce(new.points_awarded,0) WHERE new.member_id IS NOT NULL
  ON CONFLICT(member_id) DO UPDATE SET chore_earned=chore_earned+excluded.chore_earned;
END;
CREATE TRIGGER totals_chore_earned_delete AFTER DELETE ON chore_completions BEGIN
  UPDATE member_point_totals SET chore_earned=chore_earned-(coalesce(old.points_awarded,0)) WHERE member_id=old.member_id;
END;
CREATE TRIGGER totals_chore_earned_update AFTER UPDATE ON chore_completions BEGIN
  UPDATE member_point_totals SET chore_earned=chore_earned-(coalesce(old.points_awarded,0)) WHERE member_id=old.member_id;
  INSERT INTO member_point_totals(member_id,chore_earned) SELECT new.member_id, coalesce(new.points_awarded,0) WHERE new.member_id IS NOT NULL
  ON CONFLICT(member_id) DO UPDATE SET chore_earned=chore_earned+excluded.chore_earned;
END;
CREATE TRIGGER totals_ledger_insert AFTER INSERT ON point_entries BEGIN
  INSERT INTO member_point_totals(member_id,ledger_earned,ledger_spent)
  SELECT new.member_id,
    CASE WHEN new.amount>0 AND new.reason<>'reward_refund' THEN new.amount ELSE 0 END,
    CASE WHEN new.amount<0 OR new.reason='reward_refund' THEN -new.amount ELSE 0 END
  WHERE new.member_id IS NOT NULL
  ON CONFLICT(member_id) DO UPDATE SET
    ledger_earned=ledger_earned+excluded.ledger_earned,
    ledger_spent=ledger_spent+excluded.ledger_spent;
END;
CREATE TRIGGER totals_ledger_delete AFTER DELETE ON point_entries BEGIN
  UPDATE member_point_totals SET
    ledger_earned=ledger_earned-(CASE WHEN old.amount>0 AND old.reason<>'reward_refund' THEN old.amount ELSE 0 END),
    ledger_spent=ledger_spent-(CASE WHEN old.amount<0 OR old.reason='reward_refund' THEN -old.amount ELSE 0 END)
  WHERE member_id=old.member_id;
END;
CREATE TRIGGER totals_ledger_update AFTER UPDATE ON point_entries BEGIN
  UPDATE member_point_totals SET
    ledger_earned=ledger_earned-(CASE WHEN old.amount>0 AND old.reason<>'reward_refund' THEN old.amount ELSE 0 END),
    ledger_spent=ledger_spent-(CASE WHEN old.amount<0 OR old.reason='reward_refund' THEN -old.amount ELSE 0 END)
  WHERE member_id=old.member_id;
  INSERT INTO member_point_totals(member_id,ledger_earned,ledger_spent)
  SELECT new.member_id,
    CASE WHEN new.amount>0 AND new.reason<>'reward_refund' THEN new.amount ELSE 0 END,
    CASE WHEN new.amount<0 OR new.reason='reward_refund' THEN -new.amount ELSE 0 END
  WHERE new.member_id IS NOT NULL
  ON CONFLICT(member_id) DO UPDATE SET
    ledger_earned=ledger_earned+excluded.ledger_earned,
    ledger_spent=ledger_spent+excluded.ledger_spent;
END;

-- The member list asks for goals by date across all members.
CREATE INDEX idx_temp_checks_goals ON temp_checks(date) WHERE goal IS NOT NULL;

-- An opaque change counter invalidates in-memory medicine counts without storing health values
-- in plaintext. It also catches imported logs and direct SQL changes.
ALTER TABLE medications ADD COLUMN log_revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER medication_log_revision_insert AFTER INSERT ON medication_log BEGIN
  UPDATE medications SET log_revision=log_revision+1 WHERE id=new.medication_id;
END;
CREATE TRIGGER medication_log_revision_delete AFTER DELETE ON medication_log BEGIN
  UPDATE medications SET log_revision=log_revision+1 WHERE id=old.medication_id;
END;
CREATE TRIGGER medication_log_revision_update AFTER UPDATE ON medication_log BEGIN
  UPDATE medications SET log_revision=log_revision+1 WHERE id IN (old.medication_id,new.medication_id);
END;
