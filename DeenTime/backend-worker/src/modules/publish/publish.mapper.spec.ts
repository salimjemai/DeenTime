import { describe, expect, it } from 'vitest';
import { TV_DISPLAY_CONFIG_DEFAULTS, toPublishArtifactJson, toTvDisplayConfigJson, tvDisplayConfigValues } from './publish.mapper.js';

describe('tvDisplayConfigValues', () => {
  it('defaults a blank accent colour and clamps the clock scale and refresh interval', () => {
    expect(tvDisplayConfigValues({ showSeconds: false, showHijri: true, accentColor: '   ', clockFontScale: 250, autoRefreshSeconds: 5 })).toEqual({
      showSeconds: false,
      showHijri: true,
      accentColor: '#00AEEF',
      clockFontScale: 200,
      autoRefreshSeconds: 15,
    });
    expect(tvDisplayConfigValues({ showSeconds: true, showHijri: false, accentColor: null, clockFontScale: 10, autoRefreshSeconds: 5000 })).toEqual({
      showSeconds: true,
      showHijri: false,
      accentColor: '#00AEEF',
      clockFontScale: 80,
      autoRefreshSeconds: 3600,
    });
  });

  it('keeps in-range values and a non-blank accent colour untouched', () => {
    expect(tvDisplayConfigValues({ showSeconds: true, showHijri: true, accentColor: ' #123456 ', clockFontScale: 120, autoRefreshSeconds: 60 })).toEqual({
      showSeconds: true,
      showHijri: true,
      accentColor: ' #123456 ',
      clockFontScale: 120,
      autoRefreshSeconds: 60,
    });
  });
});

describe('entity JSON', () => {
  it('serializes TvDisplayConfig with the entity property order and defaults', () => {
    const json = toTvDisplayConfigJson({ id: 'id-1', organizationId: 'org-1', ...TV_DISPLAY_CONFIG_DEFAULTS });
    expect(Object.keys(json)).toEqual(['id', 'organizationId', 'showSeconds', 'showHijri', 'accentColor', 'clockFontScale', 'autoRefreshSeconds']);
    expect(json).toEqual({ id: 'id-1', organizationId: 'org-1', showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 160, autoRefreshSeconds: 30 });
  });

  it('serializes PublishArtifact with enum names and an ISO timestamp', () => {
    const createdAtUtc = new Date('2026-09-10T12:34:56.789Z');
    expect(toPublishArtifactJson({ id: 'a-1', organizationId: 'org-1', year: 2026, month: 0, size: 1, orientation: 1, storageUrl: 'https://cdn.example/x.pdf', createdAtUtc })).toEqual({
      id: 'a-1',
      organizationId: 'org-1',
      year: 2026,
      month: 0,
      size: 'Tabloid',
      orientation: 'Landscape',
      storageUrl: 'https://cdn.example/x.pdf',
      createdAtUtc: '2026-09-10T12:34:56.789Z',
    });
  });
});
