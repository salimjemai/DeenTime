import { createTestApp, type TestApp } from '../support/test-app.js';

/**
 * Behind the Cloudflare Pages proxy and the tunnel every request reaches the API from
 * loopback. The IP-partitioned rate limits must follow the visitor address the proxy
 * forwards, and must ignore that header from callers that do not hold the proxy key.
 */
describe('API behind a trusted proxy', () => {
  const PROXY_KEY = 'integration-proxy-key';
  let app: TestApp;
  let attempt = 0;

  beforeAll(async () => {
    app = await createTestApp({
      configOverrides: { 'Proxy:ClientIpHeader': 'X-MasjidHub-Client-IP', 'Proxy:SharedKey': PROXY_KEY },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** A failed sign-in for a fresh email each time, so only the per-IP "auth-login" policy (10 per minute) can answer 429. */
  const login = (headers: Record<string, string>) =>
    app
      .http()
      .post('/api/v1/auth/login')
      .set(headers)
      .send({ email: `nobody-${++attempt}@masjid.test`, password: 'Wrong-password-1234' });

  it('partitions the login rate limit by the forwarded visitor address', async () => {
    const visitorA = { 'X-MasjidHub-Proxy-Key': PROXY_KEY, 'X-MasjidHub-Client-IP': '198.51.100.10' };
    const visitorB = { 'X-MasjidHub-Proxy-Key': PROXY_KEY, 'X-MasjidHub-Client-IP': '198.51.100.11' };

    for (let index = 0; index < 10; index++) expect((await login(visitorA)).status).toBe(401);
    const limited = await login(visitorA);
    expect(limited.status).toBe(429);
    expect(limited.text).toBe('');

    expect((await login(visitorB)).status).toBe(401);
  });

  it('ignores a forwarded address that arrives without the proxy key', async () => {
    // The harness's own super-user sign-in already used one permit of the loopback window.
    const statuses: number[] = [];
    for (let index = 0; index < 10; index++) {
      statuses.push((await login({ 'X-MasjidHub-Client-IP': `203.0.113.${index + 1}` })).status);
    }
    expect(statuses.slice(0, 9)).toEqual(Array<number>(9).fill(401));
    expect(statuses[9]).toBe(429);
    expect((await login({ 'X-MasjidHub-Proxy-Key': 'not-the-key', 'X-MasjidHub-Client-IP': '203.0.113.99' })).status).toBe(429);
  });
});
