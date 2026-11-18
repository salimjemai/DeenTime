import { authorize, authorizeRoles, canAccessOrganization } from '../core/auth.js';
import { currentUser, db, type App, type Ctx } from '../core/context.js';
import { newId, normalizeId, now, toJsonArray } from '../core/db.js';
import { badRequestText, forbidden, JsonResponseException, notFound, ProblemDetailsException } from '../core/errors.js';
import { empty, renderNotFound } from '../core/http.js';
import { EMPTY_GUID, isGuid } from '../core/json.js';
import { parseBody } from '../core/validation.js';
import { requestOrigin, storage, type StoredObject } from '../integrations/storage.js';
import { DESIGN_COLUMNS, identifySafeImage, toDesignJson, type DesignRow } from './design/design.mapper.js';
import { designRequestSchema, normalizeTheme } from './design/design.schemas.js';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Room for the multipart boundaries, part headers and small text fields around an 8 MB file. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Every stored key embeds a random UUID and is never rewritten, so a file can be cached
 * for good. (Express static sent "public, max-age=0"; revalidating would cost a Worker
 * request and a KV read each time.)
 */
export const UPLOADS_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function findDesign(c: Ctx, organizationId: string): Promise<DesignRow | null> {
  return db(c).first<DesignRow>(`SELECT ${DESIGN_COLUMNS} FROM "DesignSettings" WHERE "OrganizationId" = ?`, normalizeId(organizationId));
}

/** What Nest's multer interceptor turns into a BadRequestException: 400 problem+json keyed by "", no traceId. */
function multipartProblem(message: string): ProblemDetailsException {
  return new ProblemDetailsException({
    type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
    title: 'One or more validation errors occurred.',
    status: 400,
    errors: { '': [message] },
    // Present so renderError does not add one: backend-node sends this body without a traceId.
    traceId: undefined,
  });
}

/**
 * FileInterceptor('file', { limits: { fileSize: 8 MB } }): the single uploaded file of a
 * multipart/form-data request, or undefined when the request is not multipart or has no
 * such part. Oversize files are 413 with an empty body; any other file part is
 * "Unexpected field - <name>".
 */
async function readUploadedFile(c: Ctx): Promise<Uint8Array | undefined> {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!/^multipart\/form-data\s*(;|$)/i.test(contentType.trim())) return undefined;
  // Reject before buffering when the declared size cannot hold an acceptable file.
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) throw new JsonResponseException(413, '');
  if (!/boundary=/i.test(contentType)) throw multipartProblem('Multipart: Boundary not found');

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    throw multipartProblem('Multipart: Unexpected end of form');
  }
  let file: File | undefined;
  for (const [name, value] of form.entries() as IterableIterator<[string, string | File]>) {
    if (typeof value === 'string') continue;
    if (name !== 'file' || file) throw multipartProblem(`Unexpected field - ${name}`);
    if (value.size > MAX_UPLOAD_BYTES) throw new JsonResponseException(413, '');
    file = value;
  }
  return file ? new Uint8Array(await file.arrayBuffer()) : undefined;
}

/** The key below /uploads/ of a request path, or null when it cannot name a stored file. */
function uploadKey(c: Ctx): string | null {
  const pathname = new URL(c.req.url).pathname;
  const match = /^\/uploads\/(.+)$/i.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** Express static's weak ETag: W/"<size hex>-<mtime ms hex>". */
function etagFor(object: StoredObject): string {
  return `W/"${object.size.toString(16)}-${Date.parse(object.uploadedAtUtc).toString(16)}"`;
}

function isFresh(c: Ctx, etag: string, lastModified: Date): boolean {
  const noneMatch = c.req.header('If-None-Match');
  if (noneMatch) {
    const strip = (value: string) => value.trim().replace(/^W\//, '');
    return noneMatch.trim() === '*' || noneMatch.split(',').some((candidate) => strip(candidate) === strip(etag));
  }
  const modifiedSince = c.req.header('If-Modified-Since');
  if (!modifiedSince) return false;
  const since = Date.parse(modifiedSince);
  return !Number.isNaN(since) && Math.floor(lastModified.getTime() / 1000) * 1000 <= since;
}

/**
 * /api/v1/design: design settings and header image upload, plus GET /uploads/* which
 * backend-node serves with Express static from wwwroot/uploads.
 * Port of backend-node/src/modules/design/design.controller.ts.
 */
export function register(app: App): void {
  app.get('/api/v1/design/:orgId', authorize(), async (c) => {
    const orgId = c.req.param('orgId');
    if (!isGuid(orgId)) throw notFound();
    if (!canAccessOrganization(currentUser(c), orgId)) throw forbidden();
    const design = await findDesign(c, orgId);
    if (!design) throw notFound();
    return c.json(toDesignJson(design));
  });

  app.put('/api/v1/design/:orgId', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    const req = await parseBody(c, designRequestSchema);
    const orgId = c.req.param('orgId');
    if (!isGuid(orgId)) throw notFound();
    if (!canAccessOrganization(currentUser(c), orgId)) throw forbidden();
    const design = await findDesign(c, orgId);
    if (!design) {
      await db(c).run(
        `INSERT INTO "DesignSettings" (${DESIGN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        normalizeId(orgId),
        req.headerImageUrl,
        toJsonArray(req.iqamaHeadings),
        req.footerHtml,
        normalizeTheme(req.theme),
        req.tvFontScale ?? 100,
        req.widgetFontScale ?? 100,
        req.compactFontScale ?? 100,
        req.tvFontFamily ?? 'system',
        req.widgetFontFamily ?? 'system',
        req.compactFontFamily ?? 'system',
        now(),
      );
      return empty(c, 204);
    }
    await db(c).run(
      `UPDATE "DesignSettings" SET "HeaderImageUrl" = ?, "IqamaHeadings" = ?, "FooterHtml" = ?, "Theme" = ?, "TvFontScale" = ?, "WidgetFontScale" = ?, "CompactFontScale" = ?,
         "TvFontFamily" = ?, "WidgetFontFamily" = ?, "CompactFontFamily" = ?, "UpdatedAtUtc" = ? WHERE "Id" = ?`,
      req.headerImageUrl ?? design.HeaderImageUrl,
      toJsonArray(req.iqamaHeadings),
      req.footerHtml,
      normalizeTheme(req.theme ?? design.Theme),
      req.tvFontScale ?? design.TvFontScale,
      req.widgetFontScale ?? design.WidgetFontScale,
      req.compactFontScale ?? design.CompactFontScale,
      req.tvFontFamily ?? design.TvFontFamily,
      req.widgetFontFamily ?? design.WidgetFontFamily,
      req.compactFontFamily ?? design.CompactFontFamily,
      now(),
      design.Id,
    );
    return empty(c, 204);
  });

  app.post('/api/v1/design/files/header-image', authorize(), authorizeRoles('Admin', 'Editor'), async (c) => {
    // The multer interceptor runs before the handler, so its 413/400 precede the organization check.
    const file = await readUploadedFile(c);
    const orgId = c.req.query('orgId');
    const organizationId = orgId && isGuid(orgId) ? orgId : EMPTY_GUID;
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    if (!file || file.length === 0) throw badRequestText('Choose an image first.');
    const image = identifySafeImage(file);
    if (!image) throw badRequestText('Header image must be a valid PNG, JPEG, or WebP file.');

    const key = `orgs/${organizationId}/header-${crypto.randomUUID()}${image.extension}`;
    const publicUrl = await storage(c).upload(key, image.contentType, file, requestOrigin(c));

    const design = await findDesign(c, organizationId);
    if (!design) {
      await db(c).run(
        'INSERT INTO "DesignSettings" ("Id", "OrganizationId", "HeaderImageUrl", "IqamaHeadings", "Theme", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?, ?)',
        newId(),
        normalizeId(organizationId),
        publicUrl,
        toJsonArray([]),
        'default',
        now(),
      );
    } else {
      await db(c).run('UPDATE "DesignSettings" SET "HeaderImageUrl" = ?, "UpdatedAtUtc" = ? WHERE "Id" = ?', publicUrl, now(), design.Id);
    }
    return c.json({ publicUrl, appliedTo: ['tv', 'widget', 'compactWidget', 'schedulePreview'] });
  });

  // Served with the stored content type (set from the magic bytes at upload, never from the
  // client), a weak ETag, Last-Modified and conditional requests like Express static; the
  // pipeline adds X-Content-Type-Options: nosniff. Hono answers HEAD from the GET route.
  app.get('/uploads/*', async (c) => {
    const key = uploadKey(c);
    const object = key === null ? null : await storage(c).get(key);
    if (!object) return renderNotFound();
    const lastModified = new Date(object.uploadedAtUtc);
    const etag = etagFor(object);
    const headers: Record<string, string> = {
      'Cache-Control': UPLOADS_CACHE_CONTROL,
      'Last-Modified': lastModified.toUTCString(),
      ETag: etag,
    };
    if (isFresh(c, etag, lastModified)) return new Response(null, { status: 304, headers });
    return new Response(object.bytes, { status: 200, headers: { ...headers, 'Content-Type': object.contentType, 'Content-Length': String(object.size) } });
  });
}
