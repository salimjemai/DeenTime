import { PublishEmbedCode, resolvePublishEmbedCode } from './publish';

describe('resolvePublishEmbedCode', () => {
  it('uses the current app origin throughout every public link and copied snippet', () => {
    const configured: PublishEmbedCode = {
      widgetUrl: 'https://manually-configured.example/w/community mosque',
      compactWidgetUrl: 'https://manually-configured.example/w2/community mosque',
      tvUrl: 'https://manually-configured.example/tv/community mosque',
      iframe: '<iframe src="https://manually-configured.example/w/community mosque" title="Prayer times"></iframe>',
      compactIframe: '<iframe src="https://manually-configured.example/w2/community mosque" title="Compact prayer times"></iframe>',
      script: '<a href="https://manually-configured.example/tv/community mosque">Open display</a>'
    };

    const resolved = resolvePublishEmbedCode(configured, 'https://app.iqamatime.example');

    expect(resolved.widgetUrl).toBe('https://app.iqamatime.example/w/community%20mosque');
    expect(resolved.compactWidgetUrl).toBe('https://app.iqamatime.example/w2/community%20mosque');
    expect(resolved.tvUrl).toBe('https://app.iqamatime.example/tv/community%20mosque');
    expect(resolved.iframe).toContain('src="https://app.iqamatime.example/w/community%20mosque"');
    expect(resolved.compactIframe).toContain('src="https://app.iqamatime.example/w2/community%20mosque"');
    expect(resolved.script).toContain('href="https://app.iqamatime.example/tv/community%20mosque"');
    expect(JSON.stringify(resolved)).not.toContain('manually-configured.example');
  });
});
