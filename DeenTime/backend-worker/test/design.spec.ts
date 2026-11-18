import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { identifySafeImage } from '../src/modules/design/design.mapper.js';
import { normalizeTheme } from '../src/modules/design/design.schemas.js';
import { createTestApp, type SeededOrganization, type TestApp } from './support/test-app.js';

describe('design', () => {
  let app: TestApp;
  let token: string;
  let organization: SeededOrganization;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
    ({ token, organization } = await app.seed.signIn({ roles: ['Admin'] }));
  });

  const valid = { iqamaHeadings: ['FAJR', 'IQM*'] };

  function put(json: unknown, options: { token?: string; orgId?: string } = {}): Promise<Response> {
    return app.request('PUT', `/api/v1/design/${options.orgId ?? organization.id}`, { token: options.token ?? token, json });
  }

  async function get(orgId = organization.id): Promise<Record<string, unknown>> {
    const response = await app.request('GET', `/api/v1/design/${orgId}`, { token });
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  async function expectEmpty(response: Response, status: number): Promise<void> {
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  }

  async function expectNotFound(response: Response): Promise<void> {
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    expect(await response.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: 'Not Found', status: 404 });
  }

  async function errorsOf(response: Response): Promise<Record<string, string[]>> {
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    const body = (await response.json()) as { title: string; status: number; errors: Record<string, string[]> };
    expect(body.title).toBe('One or more validation errors occurred.');
    expect(Object.keys(body)).toEqual(['title', 'status', 'errors']);
    return body.errors;
  }

  it('requires a token, and Admin or Editor to write', async () => {
    await expectEmpty(await app.request('GET', `/api/v1/design/${organization.id}`), 401);
    await expectEmpty(await app.request('PUT', `/api/v1/design/${organization.id}`, { json: valid }), 401);

    const viewer = await app.seed.signIn({ roles: ['Viewer'] });
    // The role check precedes body validation.
    await expectEmpty(await put({}, { token: viewer.token, orgId: viewer.organization.id }), 403);
    await expectNotFound(await app.request('GET', `/api/v1/design/${viewer.organization.id}`, { token: viewer.token }));

    const editor = await app.seed.signIn({ roles: ['Editor'] });
    await expectEmpty(await put(valid, { token: editor.token, orgId: editor.organization.id }), 204);
  });

  it('GET: 404 without settings or for a non-guid id, 403 for another organization', async () => {
    await expectNotFound(await app.request('GET', `/api/v1/design/${organization.id}`, { token }));
    await expectNotFound(await app.request('GET', '/api/v1/design/not-a-guid', { token }));
    const other = await app.seed.organization();
    await expectEmpty(await app.request('GET', `/api/v1/design/${other.id}`, { token }), 403);
  });

  it('PUT creates the settings with defaults', async () => {
    await expectEmpty(await put(valid), 204);
    const body = await get(organization.id.toUpperCase());
    expect(Object.keys(body)).toEqual([
      'id',
      'organizationId',
      'headerImageUrl',
      'iqamaHeadings',
      'footerHtml',
      'theme',
      'tvFontScale',
      'widgetFontScale',
      'compactFontScale',
      'tvFontFamily',
      'widgetFontFamily',
      'compactFontFamily',
      'updatedAtUtc',
      'organization',
    ]);
    expect(body).toMatchObject({
      organizationId: organization.id,
      headerImageUrl: null,
      iqamaHeadings: ['FAJR', 'IQM*'],
      footerHtml: null,
      theme: 'default',
      tvFontScale: 100,
      widgetFontScale: 100,
      compactFontScale: 100,
      tvFontFamily: 'system',
      widgetFontFamily: 'system',
      compactFontFamily: 'system',
      organization: null,
    });
    expect(body.updatedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('PUT persists independent typography (backend-node e2e)', async () => {
    const full = {
      headerImageUrl: 'https://cdn.example.test/masjid.jpg',
      iqamaHeadings: ['FAJR', 'IQM*'],
      footerHtml: '<p>MasjidHub</p>',
      theme: 'classic',
      tvFontScale: 75,
      widgetFontScale: 125,
      compactFontScale: 160,
      tvFontFamily: 'classic-serif',
      widgetFontFamily: 'modern-sans',
      compactFontFamily: 'system',
    };
    await expectEmpty(await put(full), 204);
    expect(await get()).toMatchObject(full);
  });

  it('PUT on existing settings keeps what the request leaves out, except headings and footer', async () => {
    await expectEmpty(
      await put({ headerImageUrl: '/uploads/orgs/x/header.png', iqamaHeadings: ['A'], footerHtml: '<p>f</p>', theme: 'dark', tvFontScale: 80, widgetFontScale: 90, compactFontScale: 95, tvFontFamily: 'modern-sans', widgetFontFamily: 'classic-serif', compactFontFamily: 'modern-sans' }),
      204,
    );
    const first = await get();
    expect(first.theme).toBe('dark');

    await expectEmpty(await put({ iqamaHeadings: [] }), 204);
    const second = await get();
    expect(second).toMatchObject({
      id: first.id,
      headerImageUrl: '/uploads/orgs/x/header.png',
      iqamaHeadings: [],
      footerHtml: null,
      theme: 'dark',
      tvFontScale: 80,
      widgetFontScale: 90,
      compactFontScale: 95,
      tvFontFamily: 'modern-sans',
      widgetFontFamily: 'classic-serif',
      compactFontFamily: 'modern-sans',
    });

    await expectEmpty(await put({ iqamaHeadings: ['B'], theme: 'light' }), 204);
    expect(await get()).toMatchObject({ theme: 'default', iqamaHeadings: ['B'] });
    // No theme: the saved one is kept.
    await expectEmpty(await put({ iqamaHeadings: ['B'], theme: 'classic' }), 204);
    await expectEmpty(await put({ iqamaHeadings: ['B'] }), 204);
    expect((await get()).theme).toBe('classic');
    expect(await app.db.all('SELECT "Id" FROM "DesignSettings"')).toHaveLength(1);
  });

  it('PUT rejects invalid input with the original messages', async () => {
    expect(await errorsOf(await put({}))).toEqual({ IqamaHeadings: ["'Iqama Headings' must not be empty."] });
    expect(await errorsOf(await put({ iqamaHeadings: [], theme: 'classic', tvFontScale: 77, widgetFontScale: 125, compactFontScale: 160 }))).toEqual({
      '': ['Font scale must be between 75 and 160 in increments of 5.'],
    });
    expect(
      await errorsOf(
        await put({
          headerImageUrl: 'javascript:alert(1)',
          iqamaHeadings: ['x'.repeat(81)],
          footerHtml: 'x'.repeat(10_001),
          theme: 'neon',
          tvFontFamily: 'comic',
          widgetFontFamily: 'comic',
          compactFontFamily: 'comic',
        }),
      ),
    ).toEqual({
      HeaderImageUrl: ['Header image URL must be an HTTPS/HTTP address or a local uploaded image.'],
      'IqamaHeadings[0]': ["The length of 'Iqama Headings' must be 80 characters or fewer."],
      FooterHtml: ["The length of 'Footer Html' must be 10000 characters or fewer."],
      Theme: ['Theme must be default, dark, or classic.'],
      TvFontFamily: ['TV font family is not supported.'],
      WidgetFontFamily: ['Widget font family is not supported.'],
      CompactFontFamily: ['Compact font family is not supported.'],
    });
    expect(await errorsOf(await put({ iqamaHeadings: Array.from({ length: 21 }, (_, index) => `h${index}`) }))).toEqual({ IqamaHeadings: ['At most 20 display headings are allowed.'] });
    expect(await errorsOf(await put({ iqamaHeadings: [], headerImageUrl: 'https://user:pw@cdn.example.test/a.png' }))).toHaveProperty('HeaderImageUrl');
    expect(await app.db.all('SELECT "Id" FROM "DesignSettings"')).toEqual([]);
  });

  it('PUT: validation, then 404 for a non-guid id, then 403 for another organization', async () => {
    expect((await put({}, { orgId: 'not-a-guid' })).status).toBe(400);
    await expectNotFound(await put(valid, { orgId: 'not-a-guid' }));
    const other = await app.seed.organization();
    await expectEmpty(await put(valid, { orgId: other.id }), 403);

    const superUser = await app.seed.signIn({ roles: ['SuperUser'] });
    // SuperUser alone is not Admin/Editor for this endpoint, but may read any organization.
    await expectEmpty(await put(valid, { token: superUser.token, orgId: other.id }), 403);
    await expectEmpty(await put(valid), 204);
    expect((await app.request('GET', `/api/v1/design/${organization.id}`, { token: superUser.token })).status).toBe(200);
  });
});

describe('design helpers', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

  it('identifySafeImage accepts PNG, JPEG and WebP magic bytes only', () => {
    expect(identifySafeImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({ extension: '.png', contentType: 'image/png' });
    expect(identifySafeImage(bytes(0xff, 0xd8, 0xff))).toEqual({ extension: '.jpg', contentType: 'image/jpeg' });
    expect(identifySafeImage(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')))).toEqual({ extension: '.webp', contentType: 'image/webp' });
    expect(identifySafeImage(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull();
    expect(identifySafeImage(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(identifySafeImage(bytes(0xff, 0xd8))).toBeNull();
    expect(identifySafeImage(bytes(...ascii('GIF89a')))).toBeNull();
    expect(identifySafeImage(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')))).toBeNull();
    expect(identifySafeImage(bytes())).toBeNull();
  });

  it('normalizeTheme maps empty and light to default', () => {
    expect(normalizeTheme(null)).toBe('default');
    expect(normalizeTheme('  ')).toBe('default');
    expect(normalizeTheme('Light')).toBe('default');
    expect(normalizeTheme('Classic')).toBe('classic');
  });
});
