// The quiet-hours PIN keypad's rules (App.tsx PinKeypad). Pure, so node tests load it. The server
// checks the PIN and rate-limits guesses too (server/src/routes/quiet-pin.ts).

export const PIN_RE = /^\d{4,8}$/

/** How long the keypad waits after `failures` wrong tries in a row: none for the first 4, a minute
 * at 5, then doubling, never more than 30 minutes. */
export const pinWaitMs = (failures: number) => failures < 5 ? 0 : Math.min(60_000 * 2 ** (failures - 5), 30 * 60_000)

/** A digit (up to 8) or 'back'. */
export const pressPinKey = (entry: string, key: string) =>
  key === 'back' ? entry.slice(0, -1) : /^\d$/.test(key) && entry.length < 8 ? entry + key : entry
