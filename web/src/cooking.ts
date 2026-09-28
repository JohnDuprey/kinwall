// Cooking mode's pure helpers (CookingMode.tsx): the steps to cook along with, the timers a step
// has or mentions, the ingredients it uses, and where you left off.
import { itemKey } from './itemSuggest.ts'
import type { RecipeStep } from './meal-types.ts'

/** Structured steps, or the plain instructions one line per step ("1." / "Step 1:" numbering
 * dropped); a single paragraph splits into its sentences. */
export function cookingSteps(recipe: { steps?: RecipeStep[] | null; instructions: string | null }): RecipeStep[] {
  if (recipe.steps?.length) return recipe.steps
  let lines = (recipe.instructions ?? '').split('\n').map(l => l.trim().replace(/^(?:step\s*\d+[.):]?|\d+[.)])\s+/i, '')).filter(Boolean)
  if (lines.length === 1) lines = lines[0].split(/(?<=[.!?])\s+(?=[A-Z])/)
  return lines.map(text => ({ text, bullets: [] }))
}

export interface Duration { label: string; seconds: number }
const UNITS: Record<string, [string, number]> = { h: ['hr', 3600], m: ['min', 60], s: ['sec', 1] }
/** "10 minutes", "5-7 min", "1 hour", "30 seconds" as timers. A range times its low end, when
 * it's time to check. */
export function findDurations(text: string): Duration[] {
  const found = new Map<string, Duration>()
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*-?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi)) {
    const [unit, size] = UNITS[m[3][0].toLowerCase()]
    const seconds = Math.round(Number(m[1]) * size)
    const label = `${m[2] ? `${m[1]}–${m[2]}` : m[1]} ${unit}`
    if (seconds > 0) found.set(label, { label, seconds })
  }
  return [...found.values()]
}

/** The step's own timers (labeled with their name), or else the durations its text mentions. */
export function stepTimers(step: RecipeStep): Duration[] {
  if (!step.timers?.length) return findDurations([step.text, ...step.bullets].join('\n'))
  return step.timers.map(t => ({ label: `${t.name ? `${t.name} · ` : ''}${t.minutes} min`, seconds: Math.round(t.minutes * 60) }))
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

// Where you left off, per recipe on this device: just the step number.
const stepKey = (recipeId: string) => `kinwall.cookingStep.${recipeId}`
export function savedStep(recipeId: string): number {
  try { return Math.max(0, Number(localStorage.getItem(stepKey(recipeId))) || 0) } catch { return 0 }
}
export function saveStep(recipeId: string, step: number | null) {
  try { if (step) localStorage.setItem(stepKey(recipeId), String(step)); else localStorage.removeItem(stepKey(recipeId)) } catch { /* storage blocked */ }
}
