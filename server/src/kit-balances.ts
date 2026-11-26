/** Explicit links use their own item first. Other cooked recipes use the oldest arrived item. */
export function kitBalances<T extends { id: string; received_on: string; quantity: number; done: number; recipe_id?: string | null; kind?: string; cook_by?: string | null }>(kits: T[], meals: { date: string; status: string; meal_kind?: string; recipe_id?: string | null; ready_id?: string | null }[], days = 7) {
  const balances = [...kits].sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id))
    .map(k => ({ ...k, cookBy: k.cook_by ?? new Date(Date.parse(k.received_on) + (k.kind === 'prepped' ? 4 : k.kind === 'frozen' ? 90 : days) * 86400000).toISOString().slice(0, 10), left: Math.max(0, k.quantity - k.done) }));
  const cooked = [...meals].filter(m => m.status === 'prepared' && m.meal_kind !== 'dining_out').sort((a, b) => a.date.localeCompare(b.date));
  // Reserve linked units before recipe fallback, including when another meal was eaten earlier.
  for (const meal of [...cooked.filter(m => m.ready_id), ...cooked.filter(m => !m.ready_id)]) {
    const kit = meal.ready_id ? balances.find(k => k.id === meal.ready_id && k.left > 0)
      : balances.find(k => k.left > 0 && k.received_on <= meal.date && (k.recipe_id === undefined || !!meal.recipe_id && k.recipe_id === meal.recipe_id));
    if (kit) kit.left--;
  }
  return balances;
}
