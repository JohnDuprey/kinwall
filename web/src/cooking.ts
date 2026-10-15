// Cooking mode's pure helpers (CookingMode.tsx): the steps to cook along with, the timers a step
// has or mentions, the ingredients it uses, and where you left off.
import { itemKey } from './itemSuggest.ts'
import type { RecipeStep } from './meal-types.ts'
import { t } from './i18n.ts'

/** Structured steps, or the plain instructions one line per step ("1." / "Step 1:" numbering
 * dropped); a single paragraph splits into its sentences. */
export function cookingSteps(recipe: { steps?: RecipeStep[] | null; instructions: string | null }): RecipeStep[] {
  if (recipe.steps?.length) return recipe.steps
  let lines = (recipe.instructions ?? '').split('\n').map(l => l.trim().replace(/^(?:step\s*\d+[.):]?|\d+[.)])\s+/i, '')).filter(Boolean)
  if (lines.length === 1) lines = lines[0].split(/(?<=[.!?])\s+(?=[A-Z])/)
  return lines.map(text => ({ text, bullets: [] }))
}

/** `check`: a range's low end in seconds ("5–7 min": check at 5, done at 7); `seconds` is its high end. */
export interface Duration { label: string; seconds: number; check?: number }
const UNITS: Record<string, number> = { h: 3600, m: 60, s: 1 }
const unitLabel = (unit: string, n: string) => unit === 'h' ? t('{n} hr', { n }) : unit === 'm' ? t('{n} min', { n }) : t('{n} sec', { n })
/** "10 minutes", "5-7 min", "1 hour", "30 seconds" as timers. A range runs to its high end and
 * chimes at its low end, when it's time to check. */
export function findDurations(text: string): Duration[] {
  const found = new Map<string, Duration>()
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*-?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi)) {
    const unit = m[3][0].toLowerCase(), size = UNITS[unit]
    const low = Math.round(Number(m[1]) * size), high = m[2] ? Math.round(Number(m[2]) * size) : 0
    const label = unitLabel(unit, m[2] ? `${m[1]}–${m[2]}` : m[1])
    if (low > 0) found.set(label, high > low ? { label, seconds: high, check: low } : { label, seconds: low })
  }
  return [...found.values()]
}

/** The step's own timers (labeled with their name), or else the durations its text mentions. A
 * meal kit's timer is one number: when the text has a range starting there ("Roast 15–20 min"),
 * it's that range. */
export function stepTimers(step: RecipeStep): Duration[] {
  const found = findDurations([step.text, ...step.bullets].join('\n'))
  const named = durationNames(step)
  if (!step.timers?.length) return found.map(d => named.has(d.label) ? { ...d, label: `${named.get(d.label)} · ${d.label}` } : d)
  return step.timers.map(timer => {
    const seconds = Math.round(timer.minutes * 60)
    const range = found.find(d => d.check === seconds), same = range ?? found.find(d => d.seconds === seconds && d.check === undefined)
    const label = timer.name ?? (same && named.get(same.label)), name = label ? `${label} · ` : ''
    return range ? { ...range, label: name + range.label } : { label: name + t('{n} min', { n: timer.minutes }), seconds }
  })
}

const FILLER = new Set(['for', 'about', 'another', 'a', 'an', 'the', 'or', 'then', 'and', 'until', 'after', 'in'])
/** A name for each duration from the words that start its part of a sentence: "Simmer" for "…and
 * simmer 18–20 minutes", "Rest" for "Rest off the heat for 5 minutes". */
function durationNames(step: RecipeStep): Map<string, string> {
  const names = new Map<string, string>()
  for (const part of [step.text, ...step.bullets].join('\n').split(/[\n,;.:!?]+|\s+(?:and|then)\s+/i)) {
    const word = part.trim().split(/\s+/)[0] ?? ''
    if (!/^\p{L}{3,}$/u.test(word) || FILLER.has(word.toLowerCase())) continue
    for (const d of findDurations(part)) if (!names.has(d.label)) names.set(d.label, word[0].toUpperCase() + word.slice(1).toLowerCase())
  }
  return names
}

const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(itemKey)
/** The ingredients a step mentions: the whole name ("olive oil"), or its last word ("onion" for
 * "Yellow onion"), as whole words, case- and simple-plural-insensitive. */
export function stepIngredients<T extends { name: string }>(step: RecipeStep, ingredients: T[]): T[] {
  const text = ` ${words([step.text, ...step.bullets].join(' ')).join(' ')} `
  return ingredients.filter(i => {
    const name = words(i.name), last = name.at(-1) ?? ''
    return name.length > 0 && (text.includes(` ${name.join(' ')} `) || (last.length >= 3 && text.includes(` ${last} `)))
  })
}

// Where you left off, per recipe on this device: the step number and when, forgotten after half a
// day (that dinner is over) and on the last step (it's nearly done).
const stepKey = (recipeId: string) => `kinwall.cookingStep.${recipeId}`
const KEEP_MS = 12 * 3600_000
export function savedStep(recipeId: string, now = Date.now()): number {
  try {
    const saved = JSON.parse(localStorage.getItem(stepKey(recipeId)) ?? 'null') as { step?: number; at?: number } | null
    return saved && typeof saved.at === 'number' && now - saved.at < KEEP_MS ? Math.max(0, Number(saved.step) || 0) : 0
  } catch { return 0 }
}
export function saveStep(recipeId: string, step: number | null, now = Date.now()) {
  try { if (step) localStorage.setItem(stepKey(recipeId), JSON.stringify({ step, at: now })); else localStorage.removeItem(stepKey(recipeId)) } catch { /* storage blocked */ }
}
