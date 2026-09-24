import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { CategoryInputSchema, CategoryReorderSchema, CategorySchema, ErrorSchema } from '../schemas.ts';
import { parseKeywords, type CategoryRow } from '../calendar-categories.ts';

export const categoriesRoutes = createRouter();

function toApi(row: CategoryRow) {
  return { id: row.id, name: row.name, emoji: row.emoji, color: row.color, keywords: parseKeywords(row.keywords), sort: row.sort, createdAt: row.created_at };
}

categoriesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/categories',
    tags: ['Categories'],
    summary: 'List event categories, ordered by sort',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(CategorySchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort, created_at').all<CategoryRow>();
    return c.json(results.map(toApi), 200);
  },
);

categoriesRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/categories',
    tags: ['Categories'],
    summary: 'Create an event category',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CategoryInputSchema } } } },
    responses: { 201: { description: 'created', content: { 'application/json': { schema: CategorySchema } } } },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const row: CategoryRow = {
      id: crypto.randomUUID(),
      name: body.name,
      emoji: body.emoji ?? null,
      color: body.color,
      keywords: JSON.stringify(body.keywords ?? []),
      sort: body.sort ?? 0,
      created_at: new Date().toISOString(),
    };
    await c.env.DB.prepare('INSERT INTO categories (id, name, emoji, color, keywords, sort, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(row.id, row.name, row.emoji, row.color, row.keywords, row.sort, row.created_at)
      .run();
    emit(c, 'category.changed', { id: row.id });
    return c.json(toApi(row), 201);
  },
);

categoriesRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/categories/{id}',
    tags: ['Categories'],
    summary: 'Update an event category',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CategoryInputSchema.partial() } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: CategorySchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<CategoryRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const updated: CategoryRow = {
      ...existing,
      name: body.name ?? existing.name,
      emoji: body.emoji !== undefined ? body.emoji : existing.emoji,
      color: body.color ?? existing.color,
      keywords: body.keywords !== undefined ? JSON.stringify(body.keywords) : existing.keywords,
      sort: body.sort ?? existing.sort,
    };
    await c.env.DB.prepare('UPDATE categories SET name = ?, emoji = ?, color = ?, keywords = ?, sort = ? WHERE id = ?')
      .bind(updated.name, updated.emoji, updated.color, updated.keywords, updated.sort, id)
      .run();
    emit(c, 'category.changed', { id });
    return c.json(toApi(updated), 200);
  },
);

categoriesRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/categories/{id}',
    tags: ['Categories'],
    summary: 'Delete an event category (events using it fall back to the next source: series tag, keyword match, calendar default, or none)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const exists = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(id).first<{ id: string }>();
    if (!exists) return c.json({ error: 'not found' }, 404);
    await c.env.DB.batch<unknown>([
      c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id),
      c.env.DB.prepare('UPDATE events SET category_id = NULL WHERE category_id = ?').bind(id),
      c.env.DB.prepare('UPDATE calendars SET category_id = NULL WHERE category_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM event_category_overrides WHERE category_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM event_series_category_overrides WHERE category_id = ?').bind(id),
    ]);
    emit(c, 'category.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

categoriesRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/categories/reorder',
    tags: ['Categories'],
    summary: 'Reorder categories (sort = index in the given order)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CategoryReorderSchema } } } },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
  }),
  async (c) => {
    const { ids } = c.req.valid('json');
    await c.env.DB.batch<unknown>(ids.map((id, index) => c.env.DB.prepare('UPDATE categories SET sort = ? WHERE id = ?').bind(index, id)));
    emit(c, 'category.changed', {});
    return c.json({ ok: true }, 200);
  },
);
