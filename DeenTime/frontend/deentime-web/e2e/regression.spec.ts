import { test, expect, type Page } from '@playwright/test';

const email = process.env['DEENTIME_SUPERUSER_EMAIL'] ?? 'admin@deentime.dev';
const password = process.env['DEENTIME_SUPERUSER_PASSWORD'];
const apiOrigin = process.env['DEENTIME_E2E_API_URL'] ?? 'http://localhost:8080';
const webOrigin = process.env['DEENTIME_WEB_URL'] ?? 'http://127.0.0.1:4200';

async function useApi(page: Page) {
  if (apiOrigin === 'http://localhost:8080') return;
  await page.route('http://localhost:8080/**', route => {
    const redirected = route.request().url().replace('http://localhost:8080', apiOrigin);
    return route.continue({ url: redirected });
  });
}

async function signIn(page: Page) {
  await page.goto('/login');
  if (!password) {
    test.skip(true, 'Set DEENTIME_SUPERUSER_PASSWORD to run the browser regression matrix.');
  }
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/\/org\/[0-9a-f-]+\/timings/);
}

test.describe('IqamaTime browser regression matrix', () => {
  test('authenticated navigation uses the bundled icon font on every tab', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await useApi(page);
    await signIn(page);

    const font = await page.request.get(`${webOrigin}/fonts/material-symbols-outlined.woff2`);
    expect(font.ok()).toBeTruthy();
    expect((await font.body()).byteLength).toBeGreaterThan(300_000);

    for (const label of ['Prayer Times', 'Iqama', 'Design', 'Hijri', 'Publish', 'Content', 'Profile', 'Help & Tips']) {
      await page.locator('mat-nav-list').getByRole('link', { name: label, exact: true }).click();
      const icon = page.locator('mat-nav-list mat-icon').first();
      await expect(icon).toHaveCSS('font-family', /IqamaTime Material Symbols/);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(dimensions.scrollWidth, `${label} overflows horizontally`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    }

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('Hadith cards flip and Qur’an reciters can be previewed', async ({ page }) => {
    await useApi(page);
    await signIn(page);
    await page.locator('mat-nav-list').getByRole('link', { name: 'Content', exact: true }).click();

    const card = page.locator('.hadith-flip-card').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    await card.locator('.hadith-front .flip-hint').click();
    await expect(card).toHaveClass(/flipped/);
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.hadith-back')).toHaveAttribute('aria-hidden', 'false');
    await expect(card.locator('.hadith-back header')).toContainText('سنن أبي داود');
    await expect(card.locator('.hadith-back header')).toContainText('الحديث رقم ١');
    await expect(card.locator('.hadith-back .grade')).toHaveText('صحيح');
    await expect(card.locator('.hadith-back .flip-hint')).toContainText('Flip to English');
    await expect(card).toHaveAttribute('aria-label', /الحديث رقم ١/);
    const arabicFaceText = await card.locator('.hadith-back').innerText();
    expect(arabicFaceText.match(/[A-Za-z]+(?:\s+[A-Za-z]+)*/g) ?? []).toEqual(['Flip to English']);

    const longCard = page.locator('.hadith-flip-card').nth(2);
    const longText = longCard.locator('.hadith-front .hadith-scroll-area');
    await expect(longText).toHaveCSS('overflow-y', 'auto');
    const scrollMetrics = await longText.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    await longText.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(longCard).not.toHaveClass(/flipped/);

    await page.getByRole('button', { name: 'اردو', exact: true }).click();
    await expect(page.locator('.hadith-front .face-language').first()).toHaveText('اردو');

    const reciter = page.getByLabel('Qur’an reciter');
    await expect(reciter).toBeVisible();
    const choices = await reciter.locator('option').evaluateAll(options =>
      options.map(option => (option as HTMLOptionElement).value));
    expect(choices.length).toBeGreaterThan(10);
    const current = await reciter.inputValue();
    const alternative = choices.find(choice => choice !== current);
    expect(alternative).toBeTruthy();

    const sample = page.waitForResponse(response =>
      response.url().includes('/quran/showcase/ayah/') &&
      response.url().includes('/recitation/') &&
      response.ok());
    await reciter.selectOption(alternative!);
    await sample;
    await expect(page.locator('.audio-player audio')).toHaveAttribute('src', /^https?:\/\//);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBounds = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(mobileBounds.scrollWidth).toBeLessThanOrEqual(mobileBounds.clientWidth + 1);
  });

  test('all six organization tabs show their live contract state', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', response => {
      if (response.status() >= 400) consoleErrors.push(`${response.status()} ${response.url()}`);
    });
    await useApi(page);
    await signIn(page);

    const tabs = [
      { path: 'timings', heading: 'Prayer Times', content: '.prayer-card' },
      { path: 'iqama', heading: 'Iqama Schedule', content: '.quick-prayer' },
      { path: 'design', heading: 'Design your schedule', content: '.preview-shell' },
      { path: 'hijri', heading: 'Hijri Calendar', content: 'table' },
      { path: 'publish', heading: 'Publish your schedule', content: 'iframe' },
      { path: 'content', heading: 'A living library for every masjid surface.', content: '.metric-card' }
    ];

    for (const tab of tabs) {
      await page.getByRole('link', { name: new RegExp(`^${tab.path === 'timings' ? 'Prayer Times' : tab.path === 'iqama' ? 'Iqama' : tab.path[0].toUpperCase() + tab.path.slice(1)}$`, 'i') }).click();
      await expect(page.getByRole('heading', { name: tab.heading })).toBeVisible();
      await expect(page.locator(tab.content).first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Could not load prayer times. Check criteria are set.');
    }
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('TV, full widget, and compact widget render visible public data', async ({ page }) => {
    await useApi(page);
    await signIn(page);
    const orgId = await page.evaluate(() => {
      const token = localStorage.getItem('token')!;
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.orgId as string;
    });
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const organization = await page.request.get(`${apiOrigin}/api/v1/orgs/${orgId}`, { headers: { Authorization: `Bearer ${token}` } });
    const org = await organization.json();

    await page.goto(`/tv/${org.slug}`);
    await expect(page.getByText('LIVE PRAYER DISPLAY')).toBeVisible();
    await expect(page.locator('.prayer-card').first()).toBeVisible();
    await expect(page.getByText(/Adhan and congregational Iqama times update automatically/)).toBeVisible();
    await expect(page.getByText('Adhan', { exact: true }).first()).toBeVisible();

    await page.goto(`/w/${org.slug}`);
    await expect(page.getByText('DAILY PRAYER TIMES')).toBeVisible();
    await expect(page.locator('.daily-schedule .prayer-row').first()).toBeVisible();
    await expect(page.getByText('Powered by IqamaTime')).toBeVisible();

    await page.goto(`/w2/${org.slug}`);
    await expect(page.getByText('DAILY PRAYER TIMES')).toBeVisible();
    await expect(page.locator('.widget.compact')).toBeVisible();
    await expect(page.locator('.daily-schedule .prayer-row').first()).toBeVisible();

    const externalUrl = `http://127.0.0.1:4300/?src=${encodeURIComponent(`${webOrigin}/w/${org.slug}`)}`;
    await page.goto(externalUrl);
    const externalFrame = page.frameLocator('iframe[title="IqamaTime external-origin test"]');
    await expect(externalFrame.getByText('DAILY PRAYER TIMES')).toBeVisible();
    await expect(externalFrame.getByText('Powered by IqamaTime')).toBeVisible();
  });

  test('Design controls rehydrate from the server and propagate to every public layout', async ({ page }) => {
    await useApi(page);
    await signIn(page);
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString()) as { orgId: string };
    const authHeaders = { Authorization: `Bearer ${token}` };

    await page.getByRole('link', { name: /^Design$/ }).click();
    await expect(page.getByText('Typography per layout')).toBeVisible();
    await expect(page.getByText('TV display', { exact: true })).toBeVisible();
    await expect(page.getByText('Full widget', { exact: true })).toBeVisible();
    await expect(page.getByText('Compact widget', { exact: true })).toBeVisible();

    const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const upload = await page.request.post(`${apiOrigin}/api/v1/design/files/header-image?orgId=${payload.orgId}`, {
      headers: authHeaders,
      multipart: { file: { name: 'e2e-header.png', mimeType: 'image/png', buffer: onePixelPng } }
    });
    expect(upload.ok()).toBeTruthy();

    const saved = await page.request.put(`${apiOrigin}/api/v1/design/${payload.orgId}`, {
      headers: { ...authHeaders, 'content-type': 'application/json' },
      data: {
        iqamaHeadings: ['FAJR', 'IQM*'], theme: 'classic',
        tvFontScale: 75, widgetFontScale: 125, compactFontScale: 160,
        tvFontFamily: 'classic-serif', widgetFontFamily: 'modern-sans', compactFontFamily: 'system'
      }
    });
    expect(saved.ok()).toBeTruthy();

    const organizationResponse = await page.request.get(`${apiOrigin}/api/v1/orgs/${payload.orgId}`, { headers: authHeaders });
    const organization = await organizationResponse.json() as { slug: string };
    for (const [route, scale, familyClass] of [
      ['tv', '0.75', 'font-classic-serif'],
      ['w', '1.25', 'font-modern-sans'],
      ['w2', '1.6', 'font-system']
    ] as const) {
      await page.goto(`${webOrigin}/${route}/${organization.slug}`);
      const root = page.locator(route === 'tv' ? '.tv-page' : '.widget');
      await expect(root).toHaveClass(new RegExp(familyClass));
      await expect(root).toHaveAttribute('style', new RegExp(`--font-scale:\\s*${scale}`));
      if (route === 'tv') await expect(root.locator('xpath=..').locator('.ambient-image')).toHaveAttribute('style', /18080|18081|uploads/);
      else await expect(root.locator('.hero-image')).toHaveAttribute('src', /18080|18081|uploads/);
      await expect(page.getByText('Adhan', { exact: true }).first()).toBeVisible();
    }

    const scaleKeys = { tv: 'tvFontScale', w: 'widgetFontScale', w2: 'compactFontScale' } as const;
    const viewports = { tv: { width: 1920, height: 1080 }, w: { width: 390, height: 920 }, w2: { width: 330, height: 820 } } as const;
    for (const route of ['tv', 'w', 'w2'] as const) {
      for (const targetScale of [75, 160]) {
        const savedScale = await page.request.put(`${apiOrigin}/api/v1/design/${payload.orgId}`, {
          headers: { ...authHeaders, 'content-type': 'application/json' },
          data: { iqamaHeadings: ['FAJR'], [scaleKeys[route]]: targetScale }
        });
        expect(savedScale.ok()).toBeTruthy();
        await page.setViewportSize(viewports[route]);
        await page.goto(`${webOrigin}/${route}/${organization.slug}`);
        const root = page.locator(route === 'tv' ? '.tv-page' : '.widget');
        await expect(root).toHaveAttribute('style', new RegExp(`--font-scale:\\s*${targetScale / 100}`));
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth
        }));
        expect(dimensions.scrollWidth, `${route} at ${targetScale}% overflows horizontally`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
        await expect(page.getByText('Adhan', { exact: true }).first()).toBeVisible();
      }
    }

    await page.goto(`${webOrigin}/org/${payload.orgId}/publish`);
    await expect(page.locator('code').filter({ hasText: `${webOrigin}/w/` }).first()).toBeVisible();
    await expect(page.locator('code').filter({ hasText: 'src="/w/' })).toHaveCount(0);
  });
});
