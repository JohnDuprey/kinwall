// Labels shared by School and the Chores cards and approvals.
import { msg, t, tm } from './i18n.ts'
import type { Chore, SchoolKind } from './types.ts'

export const SCHOOL_KINDS: { key: SchoolKind; label: string }[] = [{ key: 'lesson', label: msg('Lesson') }, { key: 'homework', label: msg('Homework') }, { key: 'test', label: msg('Test') }, { key: 'project', label: msg('Project') }]
export const schoolKindLabel = (kind: SchoolKind | null | undefined) => kind ? tm(SCHOOL_KINDS.find(k => k.key === kind)!.label) : ''

/** Schoolwork shares one category; its badge supplies the more specific kind. */
export const choreCategory = (chore: Pick<Chore, 'schoolKind' | 'category'>) => chore.schoolKind ? t('Schoolwork') : chore.category ?? ''

/** Keep the existing order within each section, with schoolwork together after ordinary chores. */
export function schoolworkGroups<T extends Pick<Chore, 'schoolKind'>>(chores: T[]): { schoolwork: boolean; chores: T[] }[] {
  return [
    { schoolwork: false, chores: chores.filter(c => !c.schoolKind) },
    { schoolwork: true, chores: chores.filter(c => !!c.schoolKind) },
  ].filter(g => g.chores.length > 0)
}
