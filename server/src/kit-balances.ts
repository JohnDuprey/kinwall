/** Cooked meals use the oldest box available on that meal's date. Done units are reserved first. */
export function kitBalances<T extends { id: string; received_on: string; quantity: number; done: number }>(kits: T[], meals: { date: string; status: string; meal_kind?: string }[], days = 7) {
  const balances = [...kits].sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id))
    .map(k => ({ ...k, cookBy: new Date(Date.parse(k.received_on) + days * 86400000).toISOString().slice(0, 10), left: Math.max(0, k.quantity - k.done) }));
  for (const meal of [...meals].filter(m => m.status === 'prepared' && m.meal_kind !== 'dining_out').sort((a, b) => a.date.localeCompare(b.date))) {
    const kit = balances.find(k => k.left > 0 && k.received_on <= meal.date);
    if (kit) kit.left--;
  }
  return balances;
}
