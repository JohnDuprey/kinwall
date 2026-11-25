import { createRoute, z } from '@hono/zod-openapi';
import { emit } from '../bus.ts';
import { RecipeTagIdSchema, RecipeTagNameSchema, RecipeTagSchema, type RecipeTag } from '../meal-schemas.ts';
import { readRecipeTags, recipeTagNameKey } from '../recipe-tags.ts';
import { createRouter } from '../router.ts';
import { ErrorSchema } from '../schemas.ts';

export const recipeTagRoutes = createRouter();
const tags = ['Meals'];
const security = [{ Bearer: [] }];
const params = z.object({ id: RecipeTagIdSchema });
const body = { required: true, content: { 'application/json': { schema: z.object({ name: RecipeTagNameSchema }).strict() } } };
const entry = { description: 'Recipe tag', content: { 'application/json': { schema: RecipeTagSchema } } };
const error = (description: string) => ({ description, content: { 'application/json': { schema: ErrorSchema } } });
const invalid = error('Invalid request');
const forbidden = error('Admin required');
const missing = error('Recipe tag not found');
const duplicate = error('Tag name already exists');

recipeTagRoutes.openapi(createRoute({
  method: 'get', path: '/api/recipe-tags', tags, security, summary: 'List the household’s recipe tags',
  responses: { 200: { description: 'Recipe tags', content: { 'application/json': { schema: z.array(RecipeTagSchema) } } } },
}), async c => c.json(await readRecipeTags(c.env.DB), 200));

recipeTagRoutes.openapi(createRoute({
  method: 'post', path: '/api/recipe-tags', tags, security, summary: 'Create a recipe tag (admin)', request: { body },
  responses: { 201: entry, 400: invalid, 403: forbidden, 409: duplicate },
}), async c => {
  const { name } = c.req.valid('json');
  const tag = await c.env.DB.prepare(`INSERT INTO recipe_tags (id, name, name_key) VALUES (?, ?, ?)
    ON CONFLICT(name_key) DO NOTHING RETURNING id, name`).bind(crypto.randomUUID(), name, recipeTagNameKey(name)).first<RecipeTag>();
  if (!tag) return c.json({ error: 'A recipe tag with that name already exists.' }, 409);
  emit(c, 'recipe.tag.changed', { id: tag.id });
  return c.json(tag, 201);
});

recipeTagRoutes.openapi(createRoute({
  method: 'patch', path: '/api/recipe-tags/{id}', tags, security, summary: 'Rename a recipe tag (admin)', request: { params, body },
  responses: { 200: entry, 400: invalid, 403: forbidden, 404: missing, 409: duplicate },
}), async c => {
  const { id } = c.req.valid('param');
  const { name } = c.req.valid('json');
  const key = recipeTagNameKey(name);
  const db = c.env.DB;
  const [updated, existing] = await db.batch<RecipeTag>([
    db.prepare(`UPDATE recipe_tags SET name = ?, name_key = ? WHERE id = ? AND NOT EXISTS
      (SELECT 1 FROM recipe_tags WHERE name_key = ? AND id <> ?) RETURNING id, name`).bind(name, key, id, key, id),
    db.prepare('SELECT id, name FROM recipe_tags WHERE id = ?').bind(id),
  ]);
  if (!existing.results.length) return c.json({ error: 'Recipe tag not found.' }, 404);
  const tag = updated.results[0];
  if (!tag) return c.json({ error: 'A recipe tag with that name already exists.' }, 409);
  emit(c, 'recipe.tag.changed', { id });
  return c.json(tag, 200);
});

recipeTagRoutes.openapi(createRoute({
  method: 'delete', path: '/api/recipe-tags/{id}', tags, security, summary: 'Delete a recipe tag and remove it from recipes (admin)', request: { params },
  responses: { 200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } }, 400: invalid, 403: forbidden, 404: missing },
}), async c => {
  const { id } = c.req.valid('param');
  const deleted = await c.env.DB.prepare('DELETE FROM recipe_tags WHERE id = ?').bind(id).run();
  if (!deleted.meta.changes) return c.json({ error: 'Recipe tag not found.' }, 404);
  emit(c, 'recipe.tag.changed', { id });
  return c.json({ ok: true }, 200);
});
