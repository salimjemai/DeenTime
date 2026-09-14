import { describe, expect, it } from 'vitest';
import { buildEmbedCode, publicUrl, resolvePublicOrigin, webUtilityHtmlEncode } from './embed-code.js';

describe('webUtilityHtmlEncode', () => {
  it('escapes markup characters like WebUtility.HtmlEncode', () => {
    expect(webUtilityHtmlEncode('Mosque <East> & Community')).toBe('Mosque &lt;East&gt; &amp; Community');
    expect(webUtilityHtmlEncode(`"quoted" & 'single' + plus`)).toBe('&quot;quoted&quot; &amp; &#39;single&#39; + plus');
  });

  it('writes Latin-1 supplement and astral characters as decimal entities only', () => {
    expect(webUtilityHtmlEncode('IqamaTime · Café €')).toBe('IqamaTime &#183; Caf&#233; €');
    expect(webUtilityHtmlEncode('☪ 😀')).toBe('☪ &#128512;');
    expect(webUtilityHtmlEncode('a\uD800b')).toBe('a�b');
  });
});

describe('resolvePublicOrigin', () => {
  it('prefers the requested origin over the configured one and keeps only the authority', () => {
    expect(resolvePublicOrigin('https://iqamatime.example/app/', 'https://configured.example', false)).toBe('https://iqamatime.example');
    expect(resolvePublicOrigin(undefined, 'https://Configured.Example:443//', false)).toBe('https://configured.example');
    expect(resolvePublicOrigin('   ', 'https://configured.example:8443', false)).toBe('https://configured.example:8443');
  });

  it('requires an absolute http(s) URL', () => {
    for (const candidate of [undefined, '', 'iqamatime.example', 'ftp://iqamatime.example', 'https://']) {
      expect(() => resolvePublicOrigin(candidate, undefined, true)).toThrow('The public app address must be an absolute http(s) URL.');
    }
  });

  it('requires a non-local https origin outside Development', () => {
    for (const candidate of ['http://iqamatime.example', 'https://localhost:4200', 'https://127.0.0.1', 'https://LOCALHOST']) {
      expect(() => resolvePublicOrigin(candidate, undefined, false)).toThrow('Production public display URLs must use a non-local HTTPS origin.');
    }
    expect(resolvePublicOrigin('http://localhost:4200', undefined, true)).toBe('http://localhost:4200');
    expect(resolvePublicOrigin(undefined, 'http://127.0.0.1:4200/', true)).toBe('http://127.0.0.1:4200');
  });
});

describe('buildEmbedCode', () => {
  const origin = 'https://iqamatime.example';
  const embedScript = '<script async src="https://iqamatime.example/iqamatime-embed.js"></script>';
  const iframeTail = 'loading="lazy" data-iqamatime-auto-height style="display:block;max-width:100%;border:0;overflow:hidden"></iframe>';

  it('builds the widget URLs, iframes and TV link exactly like PublishController.EmbedCode', () => {
    const code = buildEmbedCode(origin, { slug: 'east-mosque', name: 'Mosque <East> & Community' });
    const title = 'IqamaTime &#183; Mosque &lt;East&gt; &amp; Community';
    expect(code).toEqual({
      widgetUrl: 'https://iqamatime.example/w/east-mosque',
      combinedWidgetUrl: 'https://iqamatime.example/w/east-mosque',
      dailyWidgetUrl: 'https://iqamatime.example/w/east-mosque/daily',
      jumuahWidgetUrl: 'https://iqamatime.example/w/east-mosque/jumuah',
      compactWidgetUrl: 'https://iqamatime.example/w2/east-mosque',
      tvUrl: 'https://iqamatime.example/tv/east-mosque',
      iframe: `<iframe src="https://iqamatime.example/w/east-mosque" title="${title} prayer times" width="420" height="900" ${iframeTail}${embedScript}`,
      combinedIframe: `<iframe src="https://iqamatime.example/w/east-mosque" title="${title} prayer times" width="420" height="900" ${iframeTail}${embedScript}`,
      dailyIframe: `<iframe src="https://iqamatime.example/w/east-mosque/daily" title="${title} daily prayer times" width="420" height="720" ${iframeTail}${embedScript}`,
      jumuahIframe: `<iframe src="https://iqamatime.example/w/east-mosque/jumuah" title="${title} Friday prayer times" width="420" height="560" ${iframeTail}${embedScript}`,
      compactIframe: `<iframe src="https://iqamatime.example/w2/east-mosque" title="${title} compact prayer times" width="360" height="800" ${iframeTail}${embedScript}`,
      script: '<a href="https://iqamatime.example/tv/east-mosque">Open Mosque &lt;East&gt; &amp; Community IqamaTime TV display</a>',
    });
    expect(Object.keys(code)).toEqual(['widgetUrl', 'combinedWidgetUrl', 'dailyWidgetUrl', 'jumuahWidgetUrl', 'compactWidgetUrl', 'tvUrl', 'iframe', 'combinedIframe', 'dailyIframe', 'jumuahIframe', 'compactIframe', 'script']);
  });

  it('escapes the slug like Uri.EscapeDataString and HTML-encodes the URLs in attributes', () => {
    const code = buildEmbedCode(origin, { slug: "al noor's (1)", name: 'Al Noor' });
    expect(code.tvUrl).toBe('https://iqamatime.example/tv/al%20noor%27s%20%281%29');
    expect(code.compactIframe).toContain('src="https://iqamatime.example/w2/al%20noor%27s%20%281%29"');
    expect(publicUrl('http://localhost:4200', '///w/x')).toBe('http://localhost:4200/w/x');
  });
});
