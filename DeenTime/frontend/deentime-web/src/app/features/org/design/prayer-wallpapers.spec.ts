import { PRAYER_WALLPAPERS } from './prayer-wallpapers';
import {
  effectivePrayerDisplayAccent,
  prayerDisplayThemeCssVars,
  resolvePrayerDisplayTheme
} from '../../../shared/prayer-display-theme';

describe('PRAYER_WALLPAPERS', () => {
  it('provides 24 unique 4K wallpapers with lightweight thumbnails', () => {
    expect(PRAYER_WALLPAPERS).toHaveSize(24);
    expect(new Set(PRAYER_WALLPAPERS.map(item => item.id)).size).toBe(24);
    expect(new Set(PRAYER_WALLPAPERS.map(item => item.src)).size).toBe(24);

    for (const item of PRAYER_WALLPAPERS) {
      expect(item.src).toMatch(/^\/wallpapers\/islamic\/full\/\d{2}-.+\.jpg$/);
      expect(item.thumbnail).toMatch(/^\/wallpapers\/islamic\/thumbs\/\d{2}-.+\.jpg$/);
      expect(item.displayTheme.id).toBe(item.id);
      expect(['light', 'dark']).toContain(item.displayTheme.mode);
      expect(item.displayTheme.panel).toBeTruthy();
      expect(item.displayTheme.contentSurface).toBeTruthy();
      expect(item.displayTheme.typeScale).toBeGreaterThanOrEqual(1);
    }
  });

  it('resolves versioned gallery URLs to their own light or dark contrast profile', () => {
    const ivory = resolvePrayerDisplayTheme('http://localhost:4200/wallpapers/islamic/full/11-ivory-gold.jpg?v=42');
    const midnight = resolvePrayerDisplayTheme('/wallpapers/islamic/full/01-midnight-lattice.jpg');

    expect(ivory.mode).toBe('light');
    expect(ivory.accent).toBe('#8d681d');
    expect(midnight.mode).toBe('dark');
    expect(midnight.accent).toBe('#67d3ff');
    expect(ivory.panel).not.toBe(midnight.panel);
  });

  it('uses each wallpaper accent unless a masjid deliberately chose a custom color', () => {
    const theme = resolvePrayerDisplayTheme('/wallpapers/islamic/full/22-pastel-sunrise.jpg');
    expect(effectivePrayerDisplayAccent(theme, '#00AEEF')).toBe('#805486');
    expect(effectivePrayerDisplayAccent(theme, '#B4235A')).toBe('#B4235A');
    expect(prayerDisplayThemeCssVars(theme)['--display-page-text']).toBe('#3d2f48');
  });
});
