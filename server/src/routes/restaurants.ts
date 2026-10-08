// The restaurant binder (Meals → Restaurants): places the family orders from, their menus and the
// family's favorites. Parents edit (admin); walls and kids' devices read (DISPLAY_ALLOWED).
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';
import { MenuItemSchema, MenuTextParseSchema, RestaurantInputSchema, RestaurantSchema, type Meal, type Restaurant } from '../meal-schemas.ts';
import { parseMenuText } from '../menu-text.ts';
import { linkDetails, mapsPlace, nameKey, normalizeLink, parsePrice, splitMenuHeader, type PlaceDetails } from '../restaurant-import.ts';
import type { Context } from 'hono';
import type { KinwallDb } from '../db.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { todayInTz } from './members.ts';

export const restaurantRoutes = createRouter();
const params = z.object({ id: z.string() });
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: 'admin required', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
};
const one = { description: 'restaurant', content: { 'application/json': { schema: RestaurantSchema } } };
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

type Row = { id: string; name: string; cuisine: string | null; phone: string | null; address: string | null; website: string | null; order_url: string | null; menu_url: string | null; notes: string | null; archived: number; created_at: string; updated_at: string };
type ItemRow = { id: string; restaurant_id: string; section: string | null; name: string; description: string | null; price_cents: number | null; favorite: number; sort: number };

export async function readRestaurants(db: KinwallDb, opts: { id?: string; search?: string; archived?: boolean } = {}): Promise<Restaurant[]> {
  const where: string[] = [], binds: unknown[] = [];
  if (opts.id) { where.push('r.id = ?'); binds.push(opts.id) }
  if (!opts.archived) where.push('r.archived = 0');
  if (opts.search) {
    const like = `%${opts.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push("(r.name LIKE ? ESCAPE '\\' OR r.cuisine LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM restaurant_menu_items i WHERE i.restaurant_id = r.id AND i.name LIKE ? ESCAPE '\\'))");
    binds.push(like, like, like);
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Nights from here: from yesterday in UTC, trimmed to the household's today below (one round trip).
  const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const [rows, items, tz, nights, past] = await db.batch<unknown>([
    db.prepare(`SELECT r.* FROM restaurants r ${filter} ORDER BY r.name COLLATE NOCASE`).bind(...binds),
    db.prepare(`SELECT i.* FROM restaurant_menu_items i JOIN restaurants r ON r.id = i.restaurant_id ${filter} ORDER BY i.sort`).bind(...binds),
    db.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
    db.prepare(`SELECT m.id, m.restaurant_id, m.date, m.slot, m.planned_time, m.order_type, m.status, m.eater_ids, (SELECT count(*) FROM meal_orders o WHERE o.meal_id = m.id) AS orders
      FROM meals m JOIN restaurants r ON r.id = m.restaurant_id ${filter ? `${filter} AND` : 'WHERE'} m.date >= ? ORDER BY m.date, m.planned_time`).bind(...binds, since),
    // ponytail: every past order at these places, newest first, to find each person's latest; fine for a family's years of takeout.
    db.prepare(`SELECT m.restaurant_id, m.id AS meal_id, m.date, o.member_id, o.items FROM meal_orders o JOIN meals m ON m.id = o.meal_id JOIN restaurants r ON r.id = m.restaurant_id
      ${filter ? `${filter} AND` : 'WHERE'} m.status != 'planned' AND o.items != '[]' ORDER BY m.date DESC, m.updated_at DESC`).bind(...binds),
  ]);
  const today = todayInTz((tz.results[0] as { value: string } | undefined)?.value || hostTimezone());
  const upcoming = new Map<string, NonNullable<Restaurant['upcoming']>>();
  for (const m of nights.results as { id: string; restaurant_id: string; date: string; slot: Meal['slot']; planned_time: string | null; order_type: Meal['orderType']; status: Meal['status']; eater_ids: string | null; orders: number }[]) {
    if (m.date >= today) upcoming.set(m.restaurant_id, [...(upcoming.get(m.restaurant_id) ?? []), { mealId: m.id, date: m.date, slot: m.slot, plannedTime: m.planned_time, orderType: m.order_type, status: m.status, eaterIds: m.eater_ids ? JSON.parse(m.eater_ids) : [], orderCount: m.orders }]);
  }
  const last = new Map<string, NonNullable<Restaurant['lastOrders']>>();
  for (const o of past.results as { restaurant_id: string; meal_id: string; date: string; member_id: string; items: string }[]) {
    const mine = last.get(o.restaurant_id) ?? [];
    if (!mine.some((x) => x.memberId === o.member_id)) last.set(o.restaurant_id, [...mine, { memberId: o.member_id, mealId: o.meal_id, date: o.date, items: JSON.parse(o.items) }]);
  }
  const menus = new Map<string, Restaurant['menu']>();
  for (const i of items.results as ItemRow[]) menus.set(i.restaurant_id, [...(menus.get(i.restaurant_id) ?? []), { id: i.id, section: i.section, name: i.name, description: i.description, priceCents: i.price_cents, favorite: !!i.favorite, sort: i.sort }]);
  return (rows.results as Row[]).map((r) => ({ id: r.id, name: r.name, cuisine: r.cuisine, phone: r.phone, address: r.address, website: r.website, orderUrl: r.order_url, menuUrl: r.menu_url, notes: r.notes, archived: !!r.archived, menu: menus.get(r.id) ?? [], lastOrders: last.get(r.id) ?? [], upcoming: upcoming.get(r.id) ?? [], createdAt: r.created_at, updatedAt: r.updated_at }));
}

async function saveRestaurant(db: KinwallDb, input: z.infer<typeof RestaurantInputSchema>, old?: Restaurant): Promise<Restaurant> {
  const id = old?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const r = { cuisine: null, phone: null, address: null, website: null, orderUrl: null, menuUrl: null, notes: null, archived: false, ...old, ...input };
  const writes = [db.prepare(`INSERT INTO restaurants (id,name,cuisine,phone,address,website,order_url,menu_url,notes,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,cuisine=excluded.cuisine,phone=excluded.phone,address=excluded.address,website=excluded.website,order_url=excluded.order_url,menu_url=excluded.menu_url,notes=excluded.notes,archived=excluded.archived,updated_at=excluded.updated_at`)
    .bind(id, r.name, r.cuisine || null, r.phone || null, r.address || null, r.website || null, r.orderUrl || null, r.menuUrl || null, r.notes || null, r.archived ? 1 : 0, old?.createdAt ?? now, now)];
  if (input.menu) {
    // An item keeps its id only if it was on this restaurant's menu; anything else is a new item.
    const mine = new Set(old?.menu.map((i) => i.id));
    const rows = input.menu.map((i, sort) => ({ id: i.id && mine.has(i.id) ? i.id : crypto.randomUUID(), section: i.section || null, name: i.name, description: i.description || null, price_cents: i.priceCents ?? null, favorite: i.favorite ? 1 : 0, sort }));
    writes.push(db.prepare('DELETE FROM restaurant_menu_items WHERE restaurant_id = ?').bind(id));
    writes.push(db.prepare(`INSERT INTO restaurant_menu_items (id,restaurant_id,section,name,description,price_cents,favorite,sort)
      SELECT value->>'id',?,value->>'section',value->>'name',value->>'description',value->>'price_cents',value->>'favorite',value->>'sort' FROM json_each(?)`).bind(id, JSON.stringify(rows)));
  }
  await db.batch(writes);
  return (await readRestaurants(db, { id, archived: true }))[0];
}

restaurantRoutes.openapi(createRoute({ method: 'get', path: '/api/restaurants', tags: ['Meals'], summary: 'The restaurant binder, A-Z with menus (search matches name, cuisine or a menu item; archived=true includes archived places)', security: [{ Bearer: [] }],
  request: { query: z.object({ search: z.string().max(200).optional(), archived: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'restaurants', content: { 'application/json': { schema: z.array(RestaurantSchema) } } } } }), async (c) => {
  const { search, archived } = c.req.valid('query');
  return c.json(await readRestaurants(c.env.DB, { search, archived: archived === 'true' }), 200);
});
// Static routes before /{id}.
restaurantRoutes.openapi(createRoute({ method: 'post', path: '/api/restaurants/parse-menu', tags: ['Meals'], summary: 'Read pasted menu text into menu items to review, without saving (admin)', security: [{ Bearer: [] }], request: { body: body(MenuTextParseSchema) },
  responses: { 200: { description: 'items read', content: { 'application/json': { schema: z.object({ items: z.array(MenuItemSchema.pick({ section: true, name: true, priceCents: true, description: true })) }) } } }, ...errors } }), async (c) => {
  return c.json({ items: parseMenuText(c.req.valid('json').text) }, 200);
});
// Adding from a phone (the "Add to Kinwall" Shortcut, import_restaurant): lenient on purpose, since
// what arrives is whatever Shortcuts or an AI step produced. Strings are cut to size, not refused.
const loose = z.string().max(5000).nullable().optional();
export const RestaurantImportSchema = z.object({
  name: loose, cuisine: loose, phone: loose, address: loose, website: loose.describe('The restaurant\'s site; read for details like url.'), orderUrl: loose, menuUrl: loose,
  url: loose.describe('A link the phone shared: the restaurant\'s web page (read for its schema.org Restaurant details) or an Apple Maps place (its name and address are read off the link).'),
  menuText: z.string().max(100000).nullable().optional().describe('Menu text (from a photo): one item per line with its prices at the end and its description after " — " or on the lines under it; "Section: …" lines (with the section\'s prices, if any) start sections. Coupons, hours and mailing labels are skipped, and add-ons go in an "Add-ons" section. "Name:", "Cuisine:", "Phone:", "Address:", "Website:", "Order online:" and "Menu link:" lines at the top fill those fields ("QR code:" is only shown on a preview); a "Menu:" line may separate them from the menu. Several photos\' text can come joined by "--- Page 2 ---" lines: a heading seen again ("Pizza (continued)") is the same section, and later pages\' header lines fill only what\'s still empty.'),
  menu: z.array(z.object({ section: loose, name: z.string().max(1000), description: loose, price: z.union([z.string().max(50), z.number()]).nullable().optional().describe('"$12.99", "12.99", "12" or 12.99.') })).max(500).optional(),
}).openapi('RestaurantImport');
const PlaceDetailsSchema = z.object({ name: z.string().nullable(), cuisine: z.string().nullable(), phone: z.string().nullable(), address: z.string().nullable(), website: z.string().nullable(), menuUrl: z.string().nullable() });
export const RestaurantImportResultSchema = z.object({
  restaurant: RestaurantSchema, created: z.boolean(), filled: z.array(z.string()).describe('Fields that were empty and are now filled.'),
  added: z.number().int(), skipped: z.number().int().describe('Menu items already on the menu (same name in the same section).'), summary: z.string().describe('One line for a notification, e.g. "Added 23 items to Corner Slice".'),
}).openapi('RestaurantImportResult');
const FILLABLE = ['cuisine', 'phone', 'address', 'website', 'orderUrl', 'menuUrl'] as const;
export const LABEL: Record<(typeof FILLABLE)[number], string> = { cuisine: 'cuisine', phone: 'phone', address: 'address', website: 'website', orderUrl: 'ordering link', menuUrl: 'menu link' };
const LIMIT = { name: 200, cuisine: 200, phone: 50, address: 500 } as const;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
export const andList = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** Each section's items together, sections in the order first seen and spelled as first seen: several
 * photos of one menu, or pages shared later, add to the sections already there. */
function bySection<T extends { section: string | null }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = nameKey(item.section), group = groups.get(k);
    if (group) group.push({ ...item, section: group[0].section }); else groups.set(k, [item]);
  }
  return [...groups.values()].flat();
}

/** What the import would do, without saving, or an error message for a 400. `page`: what url's page
 * says, when the caller has already read it (POST /api/share), so it isn't fetched twice. */
export async function planRestaurant(c: Context<{ Bindings: Env }>, input: z.infer<typeof RestaurantImportSchema>, page?: PlaceDetails | null) {
  const db = c.env.DB;
  const header = input.menuText ? splitMenuHeader(input.menuText) : { fields: {}, menuText: '' };
  const text = (k: 'name' | 'cuisine' | 'phone' | 'address') => (input[k]?.trim() || header.fields[k]?.trim() || null)?.slice(0, LIMIT[k]) ?? null;
  // A Maps link in website (what Shortcuts calls a place's URL can be one) is read like url, never kept as the site.
  const links = [input.url, input.website ?? header.fields.website].map(normalizeLink);
  const [url, site] = links.map((l) => (l && mapsPlace(l) ? null : l));
  const maps = links.find((l) => l && mapsPlace(l));
  const target = url ?? site;
  const found: PlaceDetails | null = maps ? await linkDetails(c.env, maps) : null;
  if (page === undefined) page = target ? await linkDetails(c.env, target) : null;
  const pick = (k: keyof PlaceDetails) => page?.[k] ?? found?.[k] ?? null;
  const fields = {
    name: text('name') ?? pick('name'), cuisine: text('cuisine') ?? pick('cuisine'), phone: text('phone') ?? pick('phone'), address: text('address') ?? pick('address'),
    website: site ?? pick('website') ?? url, orderUrl: normalizeLink(input.orderUrl ?? header.fields.orderUrl),
    menuUrl: normalizeLink(input.menuUrl ?? header.fields.menuUrl) ?? pick('menuUrl'),
  };
  if (!fields.name) return "Kinwall needs the restaurant's name. Add a name, or share the restaurant's website or Maps place.";

  const candidates = await db.prepare('SELECT id, name FROM restaurants WHERE archived = 0').all<{ id: string; name: string }>();
  const match = candidates.results.find((r) => nameKey(r.name) && nameKey(r.name) === nameKey(fields.name));
  const old = match ? (await readRestaurants(db, { id: match.id }))[0] : undefined;
  const filled = FILLABLE.filter((k) => fields[k] && !old?.[k]);

  const key = (section: string | null | undefined, name: string) => `${nameKey(section)}|${nameKey(name)}`;
  const seen = new Set(old?.menu.map((i) => key(i.section, i.name)));
  const incoming = [
    ...parseMenuText(header.menuText, { name: fields.name }),
    ...(input.menu ?? []).map((i) => ({ section: i.section?.trim().slice(0, 200) || null, name: i.name.trim().slice(0, 200), description: i.description?.trim().slice(0, 1000) || null, priceCents: parsePrice(i.price) })),
  ].filter((i) => i.name);
  const added: typeof incoming = [];
  let skipped = 0;
  for (const item of incoming) {
    // ponytail: past 500 items the rest count as skipped; a menu that big is rare.
    if (seen.has(key(item.section, item.name)) || (old?.menu.length ?? 0) + added.length >= 500) { skipped++; continue }
    seen.add(key(item.section, item.name)); added.push(item);
  }
  const sections = new Set(incoming.filter((i) => i.section).map((i) => nameKey(i.section))).size;
  // A QR code on the menu that nothing said the purpose of: shown on the preview, never saved.
  const qr = normalizeLink(header.fields.qr);
  return { fields, name: fields.name, old, filled, incoming, added, skipped, sections, qr, read: header.fields };
}

/** The import, or an error message for a 400 (planRestaurant, then saved). */
export async function importRestaurant(c: Context<{ Bindings: Env }>, input: z.infer<typeof RestaurantImportSchema>, page?: PlaceDetails | null) {
  const plan = await planRestaurant(c, input, page);
  if (typeof plan === 'string') return plan;
  const { fields, name: given, old, filled, added, skipped } = plan;
  const db = c.env.DB;
  let restaurant = old;
  if (!old || filled.length || added.length) {
    const changes = Object.fromEntries(filled.map((k) => [k, fields[k]]));
    restaurant = await saveRestaurant(db, { name: old?.name ?? given, ...changes, ...(added.length && { menu: bySection([...(old?.menu ?? []), ...added]) }) }, old);
    emit(c, 'restaurant.changed', { id: restaurant.id });
  }
  const name = restaurant!.name, extra = skipped ? ` (${skipped} already there)` : '';
  const fill = andList(filled.map((k) => LABEL[k]));
  const summary = !old ? (added.length ? `Added ${name} with ${plural(added.length, 'menu item')}${extra}` : `Added ${name} to the binder`)
    : added.length ? `Added ${plural(added.length, 'item')} to ${name}${extra}${fill ? ` and filled in ${fill}` : ''}`
    : fill ? `Filled in ${fill} for ${name}${extra}` : `${name} is already up to date${extra}`;
  return { restaurant: restaurant!, created: !old, filled, added: added.length, skipped, summary };
}

restaurantRoutes.openapi(createRoute({ method: 'post', path: '/api/restaurants/import', tags: ['Meals'], summary: 'Add a restaurant from a phone (the Apple Shortcut): matches one by name (case and punctuation ignored) or adds it, fills only empty fields, and adds menu items not already there (admin)', security: [{ Bearer: [] }], request: { body: body(RestaurantImportSchema) },
  responses: { 200: { description: 'updated', content: { 'application/json': { schema: RestaurantImportResultSchema } } }, 201: { description: 'added', content: { 'application/json': { schema: RestaurantImportResultSchema } } }, ...errors } }), async (c) => {
  const result = await importRestaurant(c, c.req.valid('json'));
  if (typeof result === 'string') return c.json({ error: result }, 400);
  return c.json(result, result.created ? 201 : 200);
});
restaurantRoutes.openapi(createRoute({ method: 'post', path: '/api/restaurants/details', tags: ['Meals'], summary: "Read a restaurant's details from its web page (schema.org Restaurant data) or an Apple Maps link, to review, without saving; nothing found gives all nulls (admin)", security: [{ Bearer: [] }],
  request: { body: body(z.object({ url: z.string().min(1).max(2000) })) }, responses: { 200: { description: 'what was found', content: { 'application/json': { schema: z.object({ details: PlaceDetailsSchema }) } } }, ...errors } }), async (c) => {
  const details = await linkDetails(c.env, c.req.valid('json').url);
  return c.json({ details: details ?? { name: null, cuisine: null, phone: null, address: null, website: null, menuUrl: null } }, 200);
});
restaurantRoutes.openapi(createRoute({ method: 'get', path: '/api/restaurants/{id}', tags: ['Meals'], summary: 'A restaurant with its menu', security: [{ Bearer: [] }], request: { params }, responses: { 200: one, ...errors } }), async (c) => {
  const found = (await readRestaurants(c.env.DB, { id: c.req.valid('param').id, archived: true }))[0];
  return found ? c.json(found, 200) : c.json({ error: 'restaurant not found' }, 404);
});
restaurantRoutes.openapi(createRoute({ method: 'post', path: '/api/restaurants', tags: ['Meals'], summary: 'Add a restaurant (admin)', security: [{ Bearer: [] }], request: { body: body(RestaurantInputSchema) }, responses: { 201: one, ...errors } }), async (c) => {
  const saved = await saveRestaurant(c.env.DB, c.req.valid('json'));
  emit(c, 'restaurant.changed', { id: saved.id });
  return c.json(saved, 201);
});
restaurantRoutes.openapi(createRoute({ method: 'patch', path: '/api/restaurants/{id}', tags: ['Meals'], summary: 'Edit or archive a restaurant; menu replaces the menu (admin)', security: [{ Bearer: [] }], request: { params, body: body(RestaurantInputSchema.partial()) }, responses: { 200: one, ...errors } }), async (c) => {
  const old = (await readRestaurants(c.env.DB, { id: c.req.valid('param').id, archived: true }))[0];
  if (!old) return c.json({ error: 'restaurant not found' }, 404);
  const saved = await saveRestaurant(c.env.DB, { name: old.name, ...c.req.valid('json') }, old);
  emit(c, 'restaurant.changed', { id: saved.id });
  return c.json(saved, 200);
});
restaurantRoutes.openapi(createRoute({ method: 'delete', path: '/api/restaurants/{id}', tags: ['Meals'], summary: 'Delete a restaurant and its menu (admin)', security: [{ Bearer: [] }], request: { params }, responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } }, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  const result = await c.env.DB.prepare('DELETE FROM restaurants WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'restaurant not found' }, 404);
  emit(c, 'restaurant.changed', { id });
  return c.json({ ok: true }, 200);
});
