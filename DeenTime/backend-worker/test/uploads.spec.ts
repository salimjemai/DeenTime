import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isValidStorageKey, KvStorageService, type UploadsKv } from '../src/integrations/storage.js';
import { MAX_UPLOAD_BYTES } from '../src/modules/design.js';
import { createTestApp, type SeededOrganization, type TestApp } from './support/test-app.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 7]);
const ORIGIN = 'https://masjidhub.test';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

function form(bytes: Uint8Array | string, options: { field?: string; filename?: string; type?: string } = {}): FormData {
  const data = new FormData();
  data.append('note', 'a text field is ignored');
  data.append(options.field ?? 'file', new File([bytes], options.filename ?? 'header.png', { type: options.type ?? 'image/png' }));
  return data;
}

describe('header image upload and /uploads/*', () => {
  let app: TestApp;
  let token: string;
  let organization: SeededOrganization;
  let storage: KvStorageService;

  beforeAll(async () => {
    app = await createTestApp();
    storage = new KvStorageService(app.env.UPLOADS as unknown as UploadsKv);
  });
  beforeEach(async () => {
    await app.reset();
    ({ token, organization } = await app.seed.signIn({ roles: ['Admin'] }));
  });

  function upload(body: BodyInit | undefined, options: { token?: string | null; orgId?: string | null; headers?: Record<string, string> } = {}): Promise<Response> {
    const orgId = options.orgId === undefined ? organization.id : options.orgId;
    const auth = options.token === undefined ? token : options.token;
    return app.request('POST', `/api/v1/design/files/header-image${orgId === null ? '' : `?orgId=${orgId}`}`, { token: auth ?? undefined, body, headers: options.headers });
  }

  async function expectEmpty(response: Response, status: number): Promise<void> {
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  }

  async function expectText(response: Response, text: string): Promise<void> {
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(text);
  }

  async function expectMultipartProblem(response: Response, message: string): Promise<void> {
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    expect(await response.json()).toEqual({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { '': [message] },
    });
  }

  async function headerImageUrl(): Promise<string | null> {
    return (await app.db.first<{ HeaderImageUrl: string | null }>('SELECT "HeaderImageUrl" FROM "DesignSettings" WHERE "OrganizationId" = ?', organization.id))?.HeaderImageUrl ?? null;
  }

  const pathOf = (publicUrl: string) => publicUrl.slice(ORIGIN.length);

  it('stores a PNG, creates the design settings and serves the file', async () => {
    const response = await upload(form(PNG, { type: 'text/html', filename: 'evil.html' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    const body = (await response.json()) as { publicUrl: string; appliedTo: string[] };
    expect(Object.keys(body)).toEqual(['publicUrl', 'appliedTo']);
    expect(body.appliedTo).toEqual(['tv', 'widget', 'compactWidget', 'schedulePreview']);
    // The extension and content type come from the magic bytes, not from the client.
    expect(body.publicUrl).toMatch(new RegExp(`^${ORIGIN}/uploads/orgs/${organization.id}/header-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\\.png$`));

    const design = await app.db.all<Record<string, unknown>>('SELECT "HeaderImageUrl", "IqamaHeadings", "Theme", "TvFontScale", "TvFontFamily" FROM "DesignSettings"');
    expect(design).toEqual([{ HeaderImageUrl: body.publicUrl, IqamaHeadings: '[]', Theme: 'default', TvFontScale: 100, TvFontFamily: 'system' }]);

    const file = await app.request('GET', pathOf(body.publicUrl));
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('image/png');
    expect(file.headers.get('Content-Length')).toBe(String(PNG.length));
    expect(file.headers.get('Cache-Control')).toBe(CACHE_CONTROL);
    expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(file.headers.get('ETag')).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(Number.isNaN(Date.parse(file.headers.get('Last-Modified') ?? ''))).toBe(false);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it('replaces the header image of existing settings and accepts JPEG and WebP', async () => {
    await app.request('PUT', `/api/v1/design/${organization.id}`, { token, json: { iqamaHeadings: ['FAJR'], theme: 'classic', tvFontScale: 120 } });

    const jpeg = (await (await upload(form(JPEG))).json()) as { publicUrl: string };
    expect(jpeg.publicUrl.endsWith('.jpg')).toBe(true);
    expect(await headerImageUrl()).toBe(jpeg.publicUrl);
    expect((await app.request('GET', pathOf(jpeg.publicUrl))).headers.get('Content-Type')).toBe('image/jpeg');

    const editor = await app.seed.signIn({ roles: ['Editor'] });
    const webp = (await (await upload(form(WEBP), { token: editor.token, orgId: editor.organization.id })).json()) as { publicUrl: string };
    expect(webp.publicUrl.endsWith('.webp')).toBe(true);
    const served = await app.request('GET', pathOf(webp.publicUrl));
    expect(served.headers.get('Content-Type')).toBe('image/webp');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(WEBP);

    const rows = await app.db.all<Record<string, unknown>>('SELECT "IqamaHeadings", "Theme", "TvFontScale" FROM "DesignSettings" WHERE "OrganizationId" = ?', organization.id);
    expect(rows).toEqual([{ IqamaHeadings: '["FAJR"]', Theme: 'classic', TvFontScale: 120 }]);
  });

  it('rejects content that is not a PNG, JPEG or WebP image (backend-node e2e)', async () => {
    const message = 'Header image must be a valid PNG, JPEG, or WebP file.';
    await expectText(await upload(form("<script>alert('not an image')</script>")), message);
    await expectText(await upload(form('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { filename: 'header.svg', type: 'image/svg+xml' })), message);
    await expectText(await upload(form('GIF89a......', { filename: 'header.gif', type: 'image/gif' })), message);
    expect(await headerImageUrl()).toBeNull();
  });

  it('asks for an image when no file arrives', async () => {
    const message = 'Choose an image first.';
    await expectText(await upload(form(new Uint8Array(0))), message);
    const noFile = new FormData();
    noFile.append('note', 'only text');
    await expectText(await upload(noFile), message);
    await expectText(await upload(undefined), message);
    await expectText(await upload(JSON.stringify({ file: 'x' }), { headers: { 'Content-Type': 'application/json' } }), message);
    // A text field named "file" is not a file.
    const textField = new FormData();
    textField.append('file', 'not a file');
    await expectText(await upload(textField), message);
  });

  it('rejects other file fields and malformed multipart bodies', async () => {
    await expectMultipartProblem(await upload(form(PNG, { field: 'photo' })), 'Unexpected field - photo');
    const two = form(PNG);
    two.append('file', new File([JPEG], 'second.jpg', { type: 'image/jpeg' }));
    await expectMultipartProblem(await upload(two), 'Unexpected field - file');
    await expectMultipartProblem(await upload('whatever', { headers: { 'Content-Type': 'multipart/form-data' } }), 'Multipart: Boundary not found');
    await expectMultipartProblem(
      await upload('--x\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nabc', { headers: { 'Content-Type': 'multipart/form-data; boundary=x' } }),
      'Multipart: Unexpected end of form',
    );
    expect(await headerImageUrl()).toBeNull();
  });

  it('rejects files over 8 MB with an empty 413', async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PNG);
    await expectEmpty(await upload(form(big)), 413);
    // Declared size alone is enough: nothing is buffered.
    await expectEmpty(await upload('x', { headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(64 * 1024 * 1024) } }), 413);
    expect(await headerImageUrl()).toBeNull();

    const limit = new Uint8Array(MAX_UPLOAD_BYTES);
    limit.set(PNG);
    const accepted = await upload(form(limit));
    expect(accepted.status).toBe(200);
    const served = await app.request('GET', pathOf(((await accepted.json()) as { publicUrl: string }).publicUrl));
    expect((await served.arrayBuffer()).byteLength).toBe(MAX_UPLOAD_BYTES);
  });

  it('checks the session, the role and the organization', async () => {
    await expectEmpty(await upload(form(PNG), { token: null }), 401);
    const viewer = await app.seed.signIn({ roles: ['Viewer'] });
    await expectEmpty(await upload(form(PNG), { token: viewer.token, orgId: viewer.organization.id }), 403);
    const other = await app.seed.organization();
    await expectEmpty(await upload(form(PNG), { orgId: other.id }), 403);
    await expectEmpty(await upload(form(PNG), { orgId: 'not-a-guid' }), 403);
    await expectEmpty(await upload(form(PNG), { orgId: null }), 403);
    // The upload interceptor's errors precede the organization check, as in backend-node.
    await expectMultipartProblem(await upload(form(PNG, { field: 'photo' }), { orgId: other.id }), 'Unexpected field - photo');
    expect(await app.db.all('SELECT "Id" FROM "DesignSettings"')).toEqual([]);
  });

  it('GET /uploads/*: 404 with an empty body for unknown or invalid keys', async () => {
    await storage.put('orgs/known/file.png', PNG, 'image/png');
    expect((await app.request('GET', '/uploads/orgs/known/file.png')).status).toBe(200);
    for (const path of [
      '/uploads/orgs/known/missing.png',
      '/uploads/orgs/known/FILE.png',
      '/uploads/orgs/known/',
      '/uploads/',
      '/uploads/orgs%2Fknown%2F..%2Fknown%2Ffile.png',
      '/uploads/orgs//known/file.png',
      '/uploads/%E0%A4%A',
      '/uploads/orgs/known/file.png%00',
    ]) {
      const response = await app.request('GET', path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).toBe('');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
    await expectEmpty(await app.request('POST', '/uploads/orgs/known/file.png'), 404);
    await expectEmpty(await app.request('DELETE', '/uploads/orgs/known/file.png'), 404);
  });

  it('GET /uploads/*: stored content type, percent-decoding, HEAD and conditional requests', async () => {
    await storage.put('docs/a b.txt', new TextEncoder().encode('<script>1</script>'), 'text/plain');
    const response = await app.request('GET', '/Uploads/docs/a%20b.txt');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe(CACHE_CONTROL);
    expect(await response.text()).toBe('<script>1</script>');

    const head = await app.request('HEAD', '/uploads/docs/a%20b.txt');
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe('text/plain');
    expect(await head.text()).toBe('');

    const etag = response.headers.get('ETag') ?? '';
    const lastModified = response.headers.get('Last-Modified') ?? '';
    const conditions: Array<Record<string, string>> = [{ 'If-None-Match': etag }, { 'If-None-Match': `"other", ${etag.replace(/^W\//, '')}` }, { 'If-None-Match': '*' }, { 'If-Modified-Since': lastModified }];
    for (const headers of conditions) {
      const notModified = await app.request('GET', '/uploads/docs/a%20b.txt', { headers });
      expect(notModified.status, JSON.stringify(headers)).toBe(304);
      expect(await notModified.text()).toBe('');
      expect(notModified.headers.get('ETag')).toBe(etag);
      expect(notModified.headers.get('Cache-Control')).toBe(CACHE_CONTROL);
    }
    expect((await app.request('GET', '/uploads/docs/a%20b.txt', { headers: { 'If-None-Match': '"nope"' } })).status).toBe(200);
    expect((await app.request('GET', '/uploads/docs/a%20b.txt', { headers: { 'If-Modified-Since': 'Thu, 01 Jan 2015 00:00:00 GMT' } })).status).toBe(200);
  });
});

describe('KvStorageService', () => {
  it('accepts clean relative keys only', () => {
    expect(isValidStorageKey('orgs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/header-1.png')).toBe(true);
    expect(isValidStorageKey('a b.txt')).toBe(true);
    for (const key of ['', '/a', 'a/', 'a//b', '.', '..', 'a/../b', 'a/./b', 'a\\b', 'a\u0000b', 'a\nb', 'x'.repeat(513)]) {
      expect(isValidStorageKey(key), JSON.stringify(key)).toBe(false);
    }
  });

  it('upload returns the public URL, refuses invalid keys and reads back metadata', async () => {
    const values = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
    const kv: UploadsKv = {
      put: async (key, value, options) => void values.set(key, { value, metadata: options?.metadata }),
      getWithMetadata: async <Metadata>(key: string) => {
        const entry = values.get(key);
        return { value: entry?.value ?? null, metadata: (entry?.metadata ?? null) as Metadata | null };
      },
    };
    const storage = new KvStorageService(kv);
    // A view into a larger buffer stores only its own bytes.
    const view = new Uint8Array([0, 0, 1, 2, 3, 0]).subarray(2, 5);
    expect(await storage.upload('orgs/a/header.png', 'image/png', view, 'https://masjid.example')).toBe('https://masjid.example/uploads/orgs/a/header.png');
    const stored = await storage.get('orgs/a/header.png');
    expect(stored).toMatchObject({ contentType: 'image/png', size: 3 });
    expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3]));
    expect(stored?.uploadedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await expect(storage.upload('../secrets', 'image/png', view, 'https://masjid.example')).rejects.toThrow('resolves outside the uploads directory');
    expect(await storage.get('../secrets')).toBeNull();
    expect(await storage.get('orgs/a/missing.png')).toBeNull();

    // Objects written without metadata are served as opaque bytes.
    values.set('legacy', { value: new ArrayBuffer(2), metadata: null });
    expect(await storage.get('legacy')).toMatchObject({ contentType: 'application/octet-stream', size: 2, uploadedAtUtc: '1970-01-01T00:00:00.000Z' });
  });
});
