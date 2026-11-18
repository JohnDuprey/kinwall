import { stored } from '../i18n.ts';
import { createRoute } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { requestKey, actorOf } from '../auth.ts';
import { emit } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';
import { PlanningApplySchema, PlanningParamsSchema, PlanningQuerySchema, PlanningSaveSchema, WeeklyPlanningSchema } from '../weekly-planning-schemas.ts';
import { applyWeeklyPlan, readWeeklyPlanning, saveWeeklyDraft } from '../weekly-planning.ts';

export const weeklyPlanningRoutes = createRouter();
weeklyPlanningRoutes.use('/api/weekly-plan*', async (c, next) => {
  if ((await requestKey(c))?.scope !== 'admin') return c.json({ error: stored('error', 'A grown-up must plan the week.') }, 403);
  c.header('Cache-Control', 'no-store');
  await next();
});
const errors = {
  400: { description: 'Invalid date or choice', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: 'Parent access required', content: { 'application/json': { schema: ErrorSchema } } },
  409: { description: 'Week or draft changed; reload and review again', content: { 'application/json': { schema: ErrorSchema } } },
};
const response = { description: 'Current week sources, saved draft and applied item links', content: { 'application/json': { schema: WeeklyPlanningSchema } } };
weeklyPlanningRoutes.openapi(createRoute({ method: 'get', path: '/api/weekly-plan', tags: ['Calendar'], summary: 'Parent: review a family week, defaulting to the next complete week', security: [{ Bearer: [] }], request: { query: PlanningQuerySchema }, responses: { 200: response, ...errors } }), async c => c.json(await readWeeklyPlanning(c.env.DB, c.req.valid('query').weekStart), 200));
weeklyPlanningRoutes.openapi(createRoute({ method: 'put', path: '/api/weekly-plan/{weekStart}', tags: ['Calendar'], summary: 'Parent: save a shared draft without adding meals, tasks or notifications (revision checked)', security: [{ Bearer: [] }], request: { params: PlanningParamsSchema, body: { content: { 'application/json': { schema: PlanningSaveSchema } } } }, responses: { 200: response, ...errors } }), async c => {
  const { weekStart } = c.req.valid('param'), { revision, draft } = c.req.valid('json');
  await saveWeeklyDraft(c.env.DB, weekStart, revision, draft);
  emit(c, 'weekly-plan.changed', { weekStart });
  return c.json(await readWeeklyPlanning(c.env.DB, weekStart), 200);
});
weeklyPlanningRoutes.openapi(createRoute({ method: 'post', path: '/api/weekly-plan/{weekStart}/apply', tags: ['Calendar'], summary: 'Parent: atomically apply a reviewed draft as new meals, explicit eligible dinner swaps, linked to-dos and open-dinner decisions; idempotent requestId, checked sourceVersion/revision', security: [{ Bearer: [] }], request: { params: PlanningParamsSchema, body: { content: { 'application/json': { schema: PlanningApplySchema } } } }, responses: { 200: response, ...errors } }), async c => {
  const { weekStart } = c.req.valid('param');
  const changes = await applyWeeklyPlan(c.env.DB, weekStart, c.req.valid('json'), await actorOf(c));
  if (changes.changed) emit(c, 'weekly-plan.changed', { weekStart });
  for (const id of changes.mealIds) emit(c, 'meal.changed', { id });
  for (const task of changes.tasks) emit(c, 'list.item.changed', { id: task.id, listId: task.listId });
  return c.json(await readWeeklyPlanning(c.env.DB, weekStart), 200);
});
