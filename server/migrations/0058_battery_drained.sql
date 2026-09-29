-- The energy battery's evening "How drained do you feel?" (routes/temp-check.ts, battery.ts):
-- full / ok / low / empty, or skip. Health data: sealed with the family's key (aad
-- '<member>:<date>:drained'). NULL = not asked or not answered.
ALTER TABLE temp_checks ADD COLUMN drained TEXT;
