// Menu text (typed, copied off a photo with Live Text / Lens, read by a phone's share sheet, or the
// phones' on-device model lines) into menu items. Pure, no DOM. What it reads:
// - An item per line with its price at the end ("Pepperoni $16", "Fries ... 3.25"), or a price alone
//   on the next line (how photo text often comes out). Several prices ("(4) $8.30 | (8) $14.50",
//   "$9.35 (Single) | $12.45 (Double)", '10": $11.40 | 14": $14.50') keep the first as the price and
//   all of them, tidied, at the start of the description.
// - Lines after an item that read like a description (lowercase, a comma list, a sentence) are its
//   description; "Name $9 — description" (the phones' model lines) says so outright.
// - A section is a "Section: …" line, a line ending in ":", a common heading ("Desserts", "Kids
//   Menu") or a short line over items. A heading with prices ('Specialty Pizza 10": $15.55') prices
//   its items that have none.
// - Add-ons and sides to swap ("Sub French Fries $1.75", "Add Ons: Bacon $2", an "Add Protein" box)
//   go together at the end in an "Add-ons" section, each saying what it goes with.
// - Coupons and promotions, hours, phone numbers, links, mailing labels, the restaurant's own name
//   and taglines are skipped.
// Several photos of one menu come joined by page lines ("--- Page 2 ---"): a page that starts with
// items stays in the section it was in, a heading seen before ("PIZZA (continued)") is that same
// section, and "Continued on back" is dropped. Every pattern here runs in linear time on a line
// (test/parser-redos.test.ts), and lines are cut to LINE_MAX first.

export type ParsedMenuItem = { section: string | null; name: string; priceCents: number | null; description: string | null };
export const ADDONS = 'Add-ons';

const PRICE_ONLY = /^\$?\s*(\d{1,4}(?:[.,]\d{1,2})?)$/;
// On a trimmed line. The match may start only at the first of a run of spaces (or a space before
// "$"), and a trailing run is trimmed only from its start: matching from every space of a long
// run of spaces or dots was quadratic.
const TRAILING_PRICE = /(?:^|(?<!\s)[\s.\-–—:·…]|\s(?=\$))\$?\s*(\d{1,4}(?:[.,]\d{1,2})?)$/;
const cents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
/** The line the phones put between photos' words ("--- Page 2 ---"), or a printed "Page 2 of 3". */
export const PAGE_LINE = /^[\s\-=–—_*·•]*page\s+\d+(?:\s*(?:of|\/)\s*\d+)?[\s\-=–—_*·•]*$/i;
const PAGE_NOTE = /^\(?\s*(?:continued(?:\s+on\s+(?:the\s+)?(?:back|next page|other side|reverse))?|see\s+(?:the\s+)?(?:back|other side|reverse)|(?:please\s+)?turn\s+over|over)\s*\)?\.?$/i;
const CONTINUED = /(?<![\s,.\-–—:])[\s,.\-–—:]+[([]?\s*(?:continued|cont'?d|cont)\.?\s*[)\]]?$/i;
const key = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const tidy = (s: string) => s.replace(/^[-•*·,\s]+/, '').replace(/(?<![\s.\-–—:·…,|])[\s.\-–—:·…,|]+$/, '').trim().slice(0, 200);
// No menu line is this long; a longer one is cut, so no line can cost much.
const LINE_MAX = 500;

// --- What isn't the menu --------------------------------------------------------------------------
// Starts a promotion: it and everything after it is skipped until the next page or section.
const PROMO = /\d\s*%\s*off\b|\bcoupons?\b|\blimit\s+(?:one|\d)|\bmust\s+present|cannot\s+be\s+combined|\blimited\s+time|\bexpires?\b|\bredeem|\bpackage\b|\bany\s+order\b|\bscan\s+to\s+order|\border\s+online|\bcall\s+(?:today|now|us)\b|\bcatering\b|\bdelivery\s+available|^hours$|\bfree\s+delivery|\bwe\s+deliver/i;
const JUNK = [
  /\d{1,2}:\d{2}\s*[ap]\.?m|\b\d{1,2}\s*[ap]m\s*[-–]/i, // hours
  /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|^\d{3}[\s.-]\d{4}$/, // phone numbers
  /\bwww\.|https?:\/\/|\b[a-z0-9-]+\.(?:com|net|org|us|biz|info|example)\b/i, // links
  /\b(?:prsrt|presorted|postage|permit\s*#|ecrwss|resident|postal\s+customer|mail\s*shark)\b/i, // mailing label
  /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/, // state and ZIP
  /^\d+\s+(?:[\p{L}.']+\s+){0,3}(?:rd|road|st|street|ave|avenue|dr|drive|ln|lane|way|blvd|hwy)\.?$/iu, // a street
  /^[-–—~=*]+\s*\S.*\S\s*[-–—~=*]+$/, // a tagline between dashes ("- PIZZA & GRILLE -")
];
const letters = (s: string) => s.match(/\p{L}/gu)?.length ?? 0;

// --- Prices ---------------------------------------------------------------------------------------
type Part = { cents: number; label: string; suffix: string; plus: boolean };
type Price = { cents: number; parts: Part[] };
// An amount: "$8.30", "+$5,00", "8.30", or a size before its price ('10"', '$10":', "14:").
const AMOUNT = /(\+\s*)?(\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)(\s*["”]\s*:?|\s*:(?!\d))?/g;
// What may follow the first amount for the rest of the line to be prices: amounts, sizes, counts
// and words like (Single) or each.
const PRICEISH = /^(?:[\s\d.,$+|·/()"”:–-]|\b(?:single|double|triple|small|sm|medium|med|large|lg|x-?large|regular|reg|half|whole|each|ea|pc|pcs|piece|pieces|lunch|dinner|cup|bowl|slice|pie)\b)*$/i;
const SUFFIX = /^(?:each|ea)$/i;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const one = (cents: number): Price => ({ cents, parts: [{ cents, label: '', suffix: '', plus: false }] });

/** All of a price's amounts as words ("(6) $5.10 · (12) $9.20"), or null when it's one plain amount. */
function priceText(p: Price | null): string | null {
  if (!p || (p.parts.length < 2 && !p.parts.some((s) => s.label || s.suffix))) return null;
  return p.parts.map((s) => [s.label, `${s.plus ? '+' : ''}${money(s.cents)}`, s.suffix].filter(Boolean).join(' ')).join(' · ');
}

/** "Veggie | Chicken Caprese" with "$11.45 | $13.50": "Veggie or Chicken Caprese", each name its own price. */
function byNames(name: string, price: Price | null): string {
  const names = name.split(/\s*\|\s*/);
  if (names.length < 2 || !price) return name;
  if (price && names.length === price.parts.length && price.parts.every((s) => !s.label)) price.parts.forEach((s, i) => { s.label = names[i]; });
  return names.join(' or ');
}

/** A line's name and its prices ("Garlic Knots (6) $5.10 | (12) $9.20" → "Garlic Knots", 510 and
 * the parts "(6) $5.10", "(12) $9.20"); price null when it has none. `rest` is the words untidied. */
function splitPrice(line: string): { name: string; rest: string; price: Price | null } {
  const plain = (rest: string, price: Price | null) => ({ name: tidy(byNames(tidy(rest), price)), rest: rest.trim(), price });
  // Where the prices start: the first "$" or "+" amount, else a decimal amount the rest of the line
  // is prices after, else a bare number at the end ("Pizza - 12"). A count or size just before it
  // ("(4) $8.30", '10" $11.40') is part of the prices.
  let at = -1;
  const dollar = /[+$]\s*\d/.exec(line) ?? (() => {
    for (const m of line.matchAll(/(?<!\d)(?<!\d[.,])\+?\d{1,4}[.,]\d{2}(?!\d)/g)) if (PRICEISH.test(line.slice(m.index))) return m;
    return null;
  })();
  if (dollar) {
    at = dollar.index;
    const before = /(?:\(\s*\d{1,3}\s*\)|\b\d{1,2}\s*["”]\s*:?)\s*$/.exec(line.slice(0, at));
    if (before) at = before.index;
  }
  if (at < 0) {
    const m = line.endsWith(':') ? null : TRAILING_PRICE.exec(line);
    return m ? plain(line.slice(0, m.index), one(cents(m[1]))) : plain(line, null);
  }
  const name = line.slice(0, at), region = line.slice(at);
  if (!PRICEISH.test(region)) {
    // A price in the middle of the words (a photo's columns read across): the first amount is the
    // price, the words around it are the line.
    const m = /\$\s*(\d{1,4}(?:[.,]\d{1,2})?)/.exec(region) ?? /\d{1,4}[.,]\d{2}/.exec(region);
    if (!m) return plain(line, null);
    return plain(`${name} ${region.slice(0, m.index)} ${region.slice(m.index + m[0].length)}`.replace(/\s+/g, ' '), one(cents(m[1] ?? m[0])));
  }
  const parts: Part[] = [];
  for (const seg of region.split(/\s*[|·/]\s*/)) {
    let size: string | null = null, a: { cents: number; plus: boolean; start: number; end: number } | null = null;
    const sizes: [number, number][] = [];
    for (const m of seg.matchAll(AMOUNT)) {
      if (m[4]) { size ??= `${m[3]}"`; sizes.push([m.index!, m.index! + m[0].length]); continue }
      const inParens = /\(\s*$/.test(seg.slice(0, m.index)) && /^\s*\)/.test(seg.slice(m.index! + m[0].length));
      if (!inParens && !a) a = { cents: cents(m[3]), plus: !!m[1], start: m.index!, end: m.index! + m[0].length };
    }
    if (!a) continue;
    let rest = seg;
    for (const [from, to] of sizes.reverse()) rest = rest.slice(0, from) + ' '.repeat(to - from) + rest.slice(to);
    const words = (x: string) => x.replace(/[$+:"”]/g, '').trim().replace(/^\((.*)\)$/, (_, w: string) => (/^\d+$/.test(w.trim()) ? `(${w.trim()})` : w.trim()));
    const pre = words(rest.slice(0, a.start)), post = words(rest.slice(a.end));
    const suffix = SUFFIX.test(post) ? post : '';
    parts.push({ cents: a.cents, label: [size, pre, suffix ? '' : post].filter(Boolean).join(' '), suffix, plus: a.plus });
  }
  if (!parts.length) return plain(line, null);
  return plain(name, { cents: parts[0].cents, parts });
}

// --- What a line is -------------------------------------------------------------------------------
const SMALL = /^(?:of|or|and|&|with|w\/|the|a|an|in|on|de|del|di|da|la|le|al|to|n|for|y|e)$/i;
const titleCase = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).every((w) => SMALL.test(w) || !/^\p{Ll}/u.test(w));
const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
// Words that are a section of a menu on their own ("Desserts", "Kids Menu", "Panini & Specialty Sandwiches").
const PLURAL = '(?:appetizers|starters|salads|soups|burgers|sandwiches|subs|grinders|hoagies|wraps|pastas|entrees|entrées|sides|desserts|beverages|drinks|platters|calzones|specials|tacos|bowls|combos|melts|paninis?)';
const HEADING_WORDS = new RegExp(`^(?:(?:[\\p{L}'’]+|&)\\s+){0,3}${PLURAL}$|^(?:(?:specialty|gourmet|house|signature|classic|kids'?|children'?s|side|daily|hot|cold)\\s+)?(?:appetizers?|salads?|soups?|pizzas?|pasta|dessert|seafood|breakfast|lunch|dinner|kids)(?:\\s+(?:&|and)\\s+\\p{L}+)?(?:\\s+menu)?$|^kids'?\\s+menu$`, 'iu');
const ADDON = /^(?:sub(?:stitute)?|add|add[- ]?ons?|additional|extra|gluten[- ]free)\b/i;
const NOTE = /^(?:all|every|each)\s+\p{L}/iu;
const LABELLED = /^[\p{L} ]{2,20}:\s+\S/u;

type Token =
  | { t: 'page' }
  | { t: 'heading'; name: string; price: Price | null; explicit: boolean }
  | { t: 'price'; price: Price }
  | { t: 'item'; name: string; price: Price; desc: string | null; addon: boolean }
  | { t: 'name'; name: string; addon: boolean }
  | { t: 'desc'; text: string; note: boolean }
  | { t: 'promo' }
  | { t: 'junk' };

function isDesc(s: string): boolean {
  if (ADDON.test(s) || CONTINUED.test(s)) return false;
  return /^[\p{Ll}&(*=†]/u.test(s) || /^\d+%/.test(s) || /[,;]/.test(s) || LABELLED.test(s) || words(s) >= 8 || (words(s) >= 4 && !titleCase(s));
}

function tokens(line: string, name: string | null): Token[] {
  if (PAGE_LINE.test(line)) return [{ t: 'page' }];
  if (PAGE_NOTE.test(line)) return [];
  const section = /^section\s*:\s*(.+)$/i.exec(line);
  if (section) { const s = splitPrice(section[1]); return s.name ? [{ t: 'heading', name: s.name, price: s.price, explicit: true }] : [] }
  if (PROMO.test(line)) return [{ t: 'promo' }];
  if (JUNK.some((re) => re.test(line))) return [{ t: 'junk' }];
  if (name && key(line) === name) return [];
  // "Wraps All wraps come with homemade chips": a heading with its note on one line.
  const withNote = /^(.{2,40}?)\s+(al{1,2}\s+\p{L}+\s+(?:come|comes|are|served|include)\b.*)$/iu.exec(line);
  if (withNote && titleCase(withNote[1]) && !isDesc(withNote[1])) return [{ t: 'heading', name: tidy(withNote[1]), price: null, explicit: true }, { t: 'desc', text: withNote[2], note: true }];
  // "Name $9 — what's in it" (the phones' model lines).
  const dash = /^(.+?\S)\s+[—–]\s+(\S.*)$/.exec(line);
  if (dash && /\p{L}/u.test(dash[2])) return [...tokens(dash[1], name).filter((x) => x.t !== 'desc'), { t: 'desc', text: dash[2], note: false }];
  // "Sub French Fries $1.75 | Sweet Fries $2.00": two items, when each part has its own name and price.
  const parts = line.split(/\s*\|\s*/);
  if (parts.length > 1 && parts.every((p) => { const s = splitPrice(p); return s.price && letters(s.name.replace(/\([^)]*\)/g, '')) >= 2 && !PRICEISH.test(s.name) }))
    return parts.flatMap((p, i) => tokens(p, name).map((x) => (i && x.t === 'item' && /^add/i.test(parts[0]) ? { ...x, addon: true } : x)));
  if (line.endsWith(':') && !LABELLED.test(line)) return [{ t: 'heading', name: tidy(line.replace(/^add[- ]?ons?\s*:/i, 'Add-ons')), price: null, explicit: true }];
  const { name: text, rest, price } = splitPrice(line.replace(/^add[- ]?ons?\s*:\s*(?=\S)/i, ''));
  const addon = ADDON.test(line);
  if (letters(text) < 2) return price ? [{ t: 'price', price }] : [];
  if (letters(line) < 3 && !price) return [];
  if (price) return [{ t: 'item', name: text, price, desc: null, addon }];
  if (isDesc(rest)) return [{ t: 'desc', text: rest.replace(/^[-•*·\s]+/, ''), note: NOTE.test(rest) }];
  if (HEADING_WORDS.test(text.replace(CONTINUED, '').trim())) return [{ t: 'heading', name: text, price: null, explicit: false }];
  return [{ t: 'name', name: text, addon }];
}

type Entry = { kind: 'heading'; name: string; price: Price | null } | { kind: 'item'; name: string; price: Price | null; desc: string[]; addon: boolean };

export function parseMenuText(text: string, opts: { name?: string | null } = {}): ParsedMenuItem[] {
  const own = opts.name ? key(opts.name) : null;
  const all = text.split(/\r?\n/).map((l) => l.slice(0, LINE_MAX).replace(/\*\*/g, '').trim()).filter((l) => /[\p{L}\d]/u.test(l)).flatMap((l) => tokens(l, own));
  // Promotions run to the next page or section. A name right over a phone number, link or tagline is
  // the restaurant's own (its logo block). A short line that isn't title case between an item's name
  // and its description, or after a description ending in a comma, is more of the description.
  const toks: Exclude<Token, { t: 'promo' | 'junk' }>[] = [];
  for (let i = 0, promo = false; i < all.length; i++) {
    const tk = all[i], prev = toks.at(-1);
    if (tk.t === 'promo') { promo = true; continue }
    if (tk.t === 'junk') { if (prev?.t === 'name' && all[i - 1] === prev) toks.pop(); continue }
    if (tk.t === 'page' || (tk.t === 'heading' && (tk.explicit || i + 1 < all.length && all[i + 1].t === 'item'))) promo = false;
    if (promo) continue;
    if (tk.t === 'name' && !tk.addon && !titleCase(tk.name) && ((prev?.t === 'name' && all[i + 1]?.t === 'desc') || (prev?.t === 'desc' && /,$/.test(prev.text)))) toks.push({ t: 'desc', text: tk.name, note: false });
    else toks.push(tk);
  }

  // Lines into headings and items with their descriptions.
  const entries: Entry[] = [];
  type Item = Extract<Entry, { kind: 'item' }>;
  let open = null as Item | null;
  const item = (name: string, price: Price | null, addon: boolean) => { open = { kind: 'item', name, price, desc: [], addon }; entries.push(open); };
  const heading = (name: string, price: Price | null) => { entries.push({ kind: 'heading', name, price }); open = null; };
  const looksLikeItem = (i: number) => {
    const a = toks[i], b = toks[i + 1];
    return a?.t === 'item' || (a?.t === 'name' && (b?.t === 'price' || (b?.t === 'desc' && !b.note)));
  };
  for (let i = 0; i < toks.length && entries.length < 1000; i++) {
    const tk = toks[i];
    if (tk.t === 'page') { open = null; continue }
    if (tk.t === 'heading') { heading(tk.name, tk.price); continue }
    if (tk.t === 'item') { item(tk.name, tk.price, tk.addon); if (tk.desc) open!.desc.push(tk.desc); continue }
    if (tk.t === 'desc') {
      if (open && !(tk.note && !open.desc.length && open.price === null)) open.desc.push(tk.text);
      continue; // a section's own note ("All burgers come with chips") has no item to go with
    }
    if (tk.t === 'price') {
      // A price under a description: the item's, read in a separate column.
      const last = entries.at(-1);
      if (open && open.price === null) { open.price = tk.price; open.name = byNames(open.name, open.price) }
      else if (!open && last?.kind === 'heading' && !last.price) last.price = tk.price; // "Specialty Pizza" over '$10": $15.55 | 14": $20.70'
      continue;
    }
    // A name with no price: names and prices read as two columns ("BLT", "Tuna Melt", "$10.45",
    // "$12.50") pair up, a name over an item is a heading, anything else an item.
    let m = 0, k = 0;
    while (toks[i + m]?.t === 'name') m++;
    while (toks[i + m + k]?.t === 'price') k++;
    if (m > 1 && k > 1) {
      const paired = Math.min(m, k), lead = m - paired;
      for (let j = 0; j < m; j++) {
        const n = toks[i + j] as Extract<Token, { t: 'name' }>;
        if (j === 0 && lead) heading(n.name, null);
        else item(n.name, j >= lead ? (toks[i + m + j - lead] as Extract<Token, { t: 'price' }>).price : null, n.addon);
      }
      i += m + k - 1;
      continue;
    }
    const next = toks[i + 1];
    if (!tk.addon && (next?.t === 'heading' ? false : next?.t === 'desc' ? next.note : looksLikeItem(i + 1))) heading(tk.name, null);
    else item(tk.name, null, tk.addon);
  }

  // A priced line with no description over items with no prices of their own is their heading
  // ("Specialty Pizza" over its pies): with several sizes, or over two or more such items.
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind !== 'item' || !e.price || e.desc.length || e.addon || words(e.name) > 4) continue;
    let run = 0;
    for (let j = i + 1; j < entries.length; j++) {
      const f = entries[j];
      if (f.kind === 'heading' || (!f.addon && (f.price || !f.desc.length))) break;
      if (!f.addon) run++;
    }
    if (run >= 2 || (run === 1 && priceText(e.price))) entries[i] = { kind: 'heading', name: e.name, price: e.price };
  }

  // Sections, heading prices, and add-ons.
  const spelled = new Map<string, string>();
  const sectionName = (line: string) => {
    const name = tidy(tidy(line).replace(CONTINUED, '')) || null;
    if (!name) return null;
    if (!spelled.has(key(name))) spelled.set(key(name), name);
    return spelled.get(key(name))!;
  };
  const items: ParsedMenuItem[] = [];
  const addons = new Map<string, { item: ParsedMenuItem; desc: string | null; for: string[] }>();
  let section: string | null = null, sectionPrice: Price | null = null, addonBox = false, regular = false, lastAddon = false;
  const describe = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' — ').slice(0, 1000) || null;
  for (const e of entries) {
    if (e.kind === 'heading') {
      if (/^add\b/i.test(e.name) && !/^add-ons$/i.test(e.name)) { addonBox = true; lastAddon = false; continue } // "Add Protein": add-ons for the section above
      section = sectionName(e.name); sectionPrice = e.price; addonBox = /^add-ons$/i.test(e.name); regular = false; lastAddon = false;
      continue;
    }
    const desc = e.desc.join(' ').replace(/\s+/g, ' ').trim() || null;
    // An add-on: said so, under an add-on box, or a plain line right after add-ons before the section's first dish.
    const addon: boolean = e.addon || addonBox || (lastAddon && !regular && !desc);
    lastAddon = addon;
    if (!addon) regular = true;
    const price = e.price ?? (addon ? null : sectionPrice);
    const item: ParsedMenuItem = { section, name: e.name.replace(/\s*\|\s*/g, ' or '), priceCents: price?.cents ?? null, description: describe(priceText(price), desc) };
    if (!addon) { items.push(item); continue }
    const k = `${key(e.name)}|${price?.cents ?? ''}`, found = addons.get(k);
    if (found) { if (section && !found.for.includes(section)) found.for.push(section) }
    else addons.set(k, { item: { ...item, section: ADDONS }, desc: item.description, for: section && !/^add-ons$/i.test(section) ? [section] : [] });
  }
  const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  for (const a of addons.values()) items.push({ ...a.item, description: describe(a.desc, a.for.length ? `For ${and(a.for)}` : null) });
  return items.slice(0, 500);
}
