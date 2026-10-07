// Pasted menu text (typed, or copied off a photo with Live Text / Lens) into menu items. Pure, no DOM.
// One item per line with its price at the end ("Pepperoni $16", "Fries ... 3.25"); a price alone on
// the next line belongs to the line above (how photo text often comes out); a line without a price
// over priced lines, or ending in ":", starts a section.

export type ParsedMenuItem = { section: string | null; name: string; priceCents: number | null };

const PRICE_ONLY = /^\$?\s*(\d{1,4}(?:[.,]\d{1,2})?)$/;
const TRAILING_PRICE = /(?:^|[\s.\-–—:·…])\$?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*$/;
const cents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
const tidy = (s: string) => s.replace(/^[-•*·\s]+/, '').replace(/[\s.\-–—:·…]+$/, '').trim().slice(0, 200);

export function parseMenuText(text: string): ParsedMenuItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /\p{L}/u.test(l) || PRICE_ONLY.test(l));
  const priced = (i: number) => i < lines.length && !PRICE_ONLY.test(lines[i]) && (TRAILING_PRICE.test(lines[i]) || PRICE_ONLY.test(lines[i + 1] ?? ''));
  const items: ParsedMenuItem[] = [];
  let section: string | null = null;
  for (let i = 0; i < lines.length && items.length < 500; i++) {
    const line = lines[i];
    if (PRICE_ONLY.test(line)) continue; // taken by the line above, or a stray number
    const own = !line.endsWith(':') && line.match(TRAILING_PRICE);
    if (own) { const name = tidy(line.slice(0, own.index)); if (name) items.push({ section, name, priceCents: cents(own[1]) }); continue }
    const next = lines[i + 1]?.match(PRICE_ONLY);
    if (next && !line.endsWith(':')) { items.push({ section, name: tidy(line), priceCents: cents(next[1]) }); i++; continue }
    if (line.endsWith(':') || priced(i + 1)) { section = tidy(line) || null; continue }
    const name = tidy(line);
    if (name) items.push({ section, name, priceCents: null });
  }
  return items;
}
