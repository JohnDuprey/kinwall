// A photo folder on the server for the Night screen and the Board (self-hosted only). Node reads the
// folder (photo-folder-node.ts) and hands it over as env.PHOTO_FOLDER; Workers never set it, so
// there it answers 404 and GET /api/settings says photoFolder: false.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { ErrorSchema } from '../schemas.ts';

export type FolderPhoto = { bytes: Uint8Array<ArrayBuffer>; type: string; caption?: string };
export type PhotoFolder = { next(): Promise<FolderPhoto | null> };

export const photoFolderRoutes = createRouter();

photoFolderRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/photo-folder/next',
    tags: ['Photos'],
    summary: "The next picture from the server's photo folder (PHOTO_FOLDER). Wall screens and kids' devices may call it.",
    description:
      'A shuffled pass over the JPEG, PNG, WebP, GIF and AVIF files in the folder and its subfolders, sent as they are (`Cache-Control: no-store`). ' +
      'The `X-Caption` header is the name of the folder the picture is in (URL-encoded), left out at the top of the folder. ' +
      '404: no photo folder on this server, or no pictures in it.',
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'the picture', content: { 'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) } } },
      404: { description: 'no pictures', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const pic = await c.env.PHOTO_FOLDER?.next();
    if (!pic) return c.json({ error: c.env.PHOTO_FOLDER ? 'No pictures in the photo folder' : 'No photo folder on this server' }, 404);
    const headers: Record<string, string> = { 'Content-Type': pic.type, 'Cache-Control': 'no-store' };
    if (pic.caption) headers['X-Caption'] = encodeURIComponent(pic.caption);
    return new Response(pic.bytes, { status: 200, headers }) as never;
  },
);
