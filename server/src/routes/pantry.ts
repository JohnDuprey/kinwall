// The pantry across pantry lists: what's expiring, and which recipes use it up (pantry.ts).
import { createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { ErrorSchema, PantryExpiringSchema, PantryQuerySchema, PantrySuggestionsQuerySchema, PantrySuggestionsSchema } from '../schemas.ts';
import { expiringWithin, pantrySuggestions, readPantry } from '../pantry.ts';
import { householdToday } from './lists.ts';

export const pantryRoutes = createRouter();
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 10;
const errors = {
  400: { description: 'invalid query', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'listId is not a pantry list', content: { 'application/json': { schema: ErrorSchema } } },
};

/** A listId the caller named must be a pantry list; null when it is (or none was named). */
async function wrongList(c: Context<{ Bindings: Env }>, listId: string | undefined) {
  if (listId === undefined) return null;
  const row = await c.env.DB.prepare("SELECT archived FROM lists WHERE id = ? AND kind = 'todo' AND purpose = 'pantry'").bind(listId).first<{ archived: number }>();
  if (!row) return c.json({ error: 'That list isn’t a pantry list.' }, 404);
  return row.archived ? c.json({ error: 'That pantry list is archived.' }, 404) : null;
}

pantryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/pantry/expiring',
    tags: ['Lists'],
    summary: 'Food to use soon: open items on pantry lists whose use-by date is within `days` (default 7), soonest and expired first',
    security: [{ Bearer: [] }],
    request: { query: PantryQuerySchema },
    responses: { 200: { description: 'expiring food', content: { 'application/json': { schema: PantryExpiringSchema } } }, ...errors },
  }),
  async (c) => {
    const { days = DEFAULT_DAYS, listId } = c.req.valid('query');
    const refused = await wrongList(c, listId);
    if (refused) return refused;
    const today = await householdToday(c.env.DB);
    return c.json({ today, days, items: expiringWithin(await readPantry(c.env.DB, today, listId), days) }, 200);
  },
);

pantryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/pantry/suggestions',
    tags: ['Lists'],
    summary: "What to eat to use up what's expiring: the family's meal recipes ranked by the expiring pantry items they use (soonest counts most), with what they use, what else they need, and the expiring items no suggested recipe uses",
    security: [{ Bearer: [] }],
    request: { query: PantrySuggestionsQuerySchema },
    responses: { 200: { description: 'suggestions', content: { 'application/json': { schema: PantrySuggestionsSchema } } }, ...errors },
  }),
  async (c) => {
    const { days = DEFAULT_DAYS, limit = DEFAULT_LIMIT, listId } = c.req.valid('query');
    const refused = await wrongList(c, listId);
    if (refused) return refused;
    return c.json(await pantrySuggestions(c.env.DB, await householdToday(c.env.DB), { days, limit, listId }), 200);
  },
);

