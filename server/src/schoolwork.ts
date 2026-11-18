// Schoolwork shares the chores table. Keep it out of everyday chore reads while School is off;
// the rows and their history remain stored. This uncorrelated settings lookup runs once per query.
export function schoolworkVisibleSql(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return `((${prefix}school_subject_id IS NULL AND ${prefix}school_kind IS NULL) OR EXISTS (SELECT 1 FROM settings WHERE key = 'features' AND json_extract(value, '$.school') = 1))`;
}
