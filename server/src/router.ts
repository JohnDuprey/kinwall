import { OpenAPIHono } from '@hono/zod-openapi';
import type { Env } from './env.ts';

// Every route file (and app.ts) must build its Hono instance via this factory instead of
// `new OpenAPIHono(...)` directly, so a request-validation failure always comes back as
// SPEC's `{ error: string }` instead of zod-openapi's default `{ error: { name, message, ... } }`.
export function createRouter() {
  return new OpenAPIHono<{ Bindings: Env }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        const field = issue?.path?.length ? issue.path.join('.') : 'request';
        return c.json({ error: `${field}: ${issue?.message ?? 'invalid request'}` }, 400);
      }
    },
  });
}
