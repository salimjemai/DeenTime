import { PublishEmbedCode, PublishEmbedCodeResponse, resolvePublishEmbedCode } from './publish';

describe('resolvePublishEmbedCode', () => {
  it('uses the current app origin throughout every public link and copied snippet', () => {
    const configured: PublishEmbedCode = {
      widgetUrl: 'https://manually-configured.example/w/community mosque',
      combinedWidgetUrl: 'https://manually-configured.example/w/community mosque',
      dailyWidgetUrl: 'https://manually-configured.example/w/community mosque/daily',
      jumuahWidgetUrl: 'https://manually-configured.example/w/community mosque/jumuah',
      compactWidgetUrl: 'https://manually-configured.example/w2/community mosque',
      tvUrl: 'https://manually-configured.example/tv/community mosque',
      iframe: '<iframe src="https://manually-configured.example/w/community mosque" title="Prayer times"></iframe>',
      combinedIframe: '<iframe src="https://manually-configured.example/w/community mosque" title="Prayer times"></iframe>',
      dailyIframe: '<iframe src="https://manually-configured.example/w/community mosque/daily" title="Daily prayer times"></iframe>',
      jumuahIframe: '<iframe src="https://manually-configured.example/w/community mosque/jumuah" title="Friday prayer times"></iframe>',
      compactIframe: '<iframe src="https://manually-configured.example/w2/community mosque" title="Compact prayer times"></iframe>',
      script: '<a href="https://manually-configured.example/tv/community mosque">Open display</a>'
    };

    const resolved = resolvePublishEmbedCode(configured, 'https://app.iqamatime.example');

    expect(resolved.widgetUrl).toBe('https://app.iqamatime.example/w/community%20mosque');
    expect(resolved.combinedWidgetUrl).toBe('https://app.iqamatime.example/w/community%20mosque');
    expect(resolved.dailyWidgetUrl).toBe('https://app.iqamatime.example/w/community%20mosque/daily');
    expect(resolved.jumuahWidgetUrl).toBe('https://app.iqamatime.example/w/community%20mosque/jumuah');
    expect(resolved.compactWidgetUrl).toBe('https://app.iqamatime.example/w2/community%20mosque');
    expect(resolved.tvUrl).toBe('https://app.iqamatime.example/tv/community%20mosque');
    expect(resolved.iframe).toContain('src="https://app.iqamatime.example/w/community%20mosque"');
    expect(resolved.combinedIframe).toContain('src="https://app.iqamatime.example/w/community%20mosque"');
    expect(resolved.dailyIframe).toContain('src="https://app.iqamatime.example/w/community%20mosque/daily"');
    expect(resolved.jumuahIframe).toContain('src="https://app.iqamatime.example/w/community%20mosque/jumuah"');
    expect(resolved.compactIframe).toContain('src="https://app.iqamatime.example/w2/community%20mosque"');
    expect(resolved.script).toContain('href="https://app.iqamatime.example/tv/community%20mosque"');
    expect(JSON.stringify(resolved)).not.toContain('manually-configured.example');
  });

  it('derives the separated widget URLs while an older API container is still rolling forward', () => {
    const legacy: PublishEmbedCodeResponse = {
      widgetUrl: 'http://api-host/w/community',
      compactWidgetUrl: 'http://api-host/w2/community',
      tvUrl: 'http://api-host/tv/community',
      iframe: '<iframe src="http://api-host/w/community"></iframe>',
      compactIframe: '<iframe src="http://api-host/w2/community"></iframe>',
      script: '<a href="http://api-host/tv/community">TV</a>'
    };

    const resolved = resolvePublishEmbedCode(legacy, 'http://localhost:4200');

    expect(resolved.dailyWidgetUrl).toBe('http://localhost:4200/w/community/daily');
    expect(resolved.jumuahWidgetUrl).toBe('http://localhost:4200/w/community/jumuah');
    expect(resolved.dailyIframe).toContain('src="http://localhost:4200/w/community/daily"');
    expect(resolved.jumuahIframe).toContain('src="http://localhost:4200/w/community/jumuah"');
    expect(resolved.dailyIframe).toContain('height="720"');
    expect(resolved.jumuahIframe).toContain('height="560"');
  });
});
