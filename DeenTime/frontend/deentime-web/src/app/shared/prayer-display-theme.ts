export type PrayerDisplayMode = 'light' | 'dark';

export interface PrayerDisplayTheme {
  id: string;
  mode: PrayerDisplayMode;
  accent: string;
  pageText: string;
  pageMuted: string;
  pageFaint: string;
  overlay: string;
  heroOverlay: string;
  panel: string;
  panelStrong: string;
  panelHeader: string;
  panelBorder: string;
  panelText: string;
  panelMuted: string;
  contentSurface: string;
  contentSurfaceStrong: string;
  contentSurfaceAlt: string;
  rowBorder: string;
  shadow: string;
  textShadow: string;
  typeScale: number;
  clockWeight: number;
}

type ThemeOverrides = Partial<Omit<PrayerDisplayTheme, 'id' | 'mode' | 'accent'>>;

const darkTheme = (id: string, accent: string, overrides: ThemeOverrides = {}): PrayerDisplayTheme => ({
  id,
  mode: 'dark',
  accent,
  pageText: '#f8fbff',
  pageMuted: 'rgba(248, 251, 255, .76)',
  pageFaint: 'rgba(248, 251, 255, .5)',
  overlay: 'linear-gradient(180deg, rgba(0, 0, 0, .22), rgba(0, 0, 0, .04) 43%, rgba(0, 0, 0, .2))',
  heroOverlay: 'linear-gradient(145deg, rgba(2, 8, 12, .58), rgba(2, 8, 12, .12) 50%, rgba(2, 8, 12, .5))',
  panel: 'rgba(8, 23, 31, .84)',
  panelStrong: 'rgba(4, 15, 23, .82)',
  panelHeader: 'rgba(255, 255, 255, .1)',
  panelBorder: 'rgba(255, 255, 255, .2)',
  panelText: '#ffffff',
  panelMuted: 'rgba(255, 255, 255, .58)',
  contentSurface: 'linear-gradient(180deg, rgba(7, 19, 18, .92), rgba(9, 25, 22, .9))',
  contentSurfaceStrong: 'rgba(8, 25, 22, .9)',
  contentSurfaceAlt: 'rgba(255, 255, 255, .055)',
  rowBorder: 'rgba(255, 255, 255, .1)',
  shadow: '0 22px 60px rgba(0, 0, 0, .34)',
  textShadow: '0 3px 18px rgba(0, 0, 0, .92), 0 12px 36px rgba(0, 0, 0, .46)',
  typeScale: 1,
  clockWeight: 310,
  ...overrides
});

const lightTheme = (id: string, accent: string, overrides: ThemeOverrides = {}): PrayerDisplayTheme => ({
  id,
  mode: 'light',
  accent,
  pageText: '#1b3029',
  pageMuted: 'rgba(27, 48, 41, .76)',
  pageFaint: 'rgba(27, 48, 41, .56)',
  overlay: 'linear-gradient(180deg, rgba(255, 255, 255, .05), transparent 48%, rgba(255, 255, 255, .08))',
  heroOverlay: 'linear-gradient(145deg, rgba(255, 255, 255, .62), rgba(255, 255, 255, .12) 50%, rgba(255, 255, 255, .52))',
  panel: 'rgba(255, 253, 247, .9)',
  panelStrong: 'rgba(255, 255, 255, .88)',
  panelHeader: 'rgba(30, 49, 42, .09)',
  panelBorder: 'rgba(36, 57, 49, .22)',
  panelText: '#172b24',
  panelMuted: 'rgba(23, 43, 36, .62)',
  contentSurface: 'linear-gradient(180deg, rgba(255, 255, 253, .94), rgba(248, 250, 246, .91))',
  contentSurfaceStrong: 'rgba(255, 255, 255, .91)',
  contentSurfaceAlt: 'rgba(31, 50, 43, .055)',
  rowBorder: 'rgba(38, 61, 52, .13)',
  shadow: '0 22px 58px rgba(55, 43, 25, .2)',
  textShadow: '0 2px 12px rgba(255, 255, 255, .96), 0 1px 2px rgba(255, 255, 255, .9)',
  typeScale: 1.03,
  clockWeight: 380,
  ...overrides
});

const WALLPAPER_THEMES: Readonly<Record<string, PrayerDisplayTheme>> = {
  '01-midnight-lattice.jpg': darkTheme('midnight-lattice', '#67d3ff', {
    panel: 'rgba(5, 24, 45, .88)', panelStrong: 'rgba(3, 16, 34, .86)', contentSurface: 'linear-gradient(180deg, rgba(5, 22, 39, .94), rgba(7, 29, 45, .91))'
  }),
  '02-turquoise-zellige.jpg': lightTheme('turquoise-zellige', '#006f70', {
    pageText: '#073b3b', panel: 'rgba(244, 255, 252, .91)', panelStrong: 'rgba(250, 255, 253, .9)', contentSurface: 'linear-gradient(180deg, rgba(247, 255, 253, .95), rgba(233, 248, 244, .92))', typeScale: 1.02
  }),
  '03-emerald-mihrab.jpg': darkTheme('emerald-mihrab', '#dfbd6b', {
    panel: 'rgba(8, 33, 23, .88)', panelStrong: 'rgba(4, 23, 16, .87)', contentSurface: 'linear-gradient(180deg, rgba(8, 31, 22, .94), rgba(12, 42, 29, .91))', typeScale: 1.02
  }),
  '04-blue-hour-courtyard.jpg': darkTheme('blue-hour-courtyard', '#85ddff', {
    panel: 'rgba(5, 25, 47, .87)', panelStrong: 'rgba(2, 17, 36, .86)', contentSurface: 'linear-gradient(180deg, rgba(5, 24, 43, .94), rgba(10, 37, 59, .91))'
  }),
  '05-desert-crescent.jpg': darkTheme('desert-crescent', '#ffd06f', {
    overlay: 'linear-gradient(180deg, rgba(0, 0, 0, .18), rgba(0, 0, 0, .02) 44%, rgba(0, 0, 0, .24))', panel: 'rgba(52, 20, 12, .85)', panelStrong: 'rgba(34, 12, 8, .84)', contentSurface: 'linear-gradient(180deg, rgba(47, 20, 13, .93), rgba(63, 29, 18, .9))', typeScale: 1.02
  }),
  '06-dawn-silhouette.jpg': lightTheme('dawn-silhouette', '#86506f', {
    pageText: '#3f2940', pageMuted: 'rgba(63, 41, 64, .75)', panel: 'rgba(255, 249, 247, .9)', contentSurface: 'linear-gradient(180deg, rgba(255, 252, 251, .95), rgba(248, 239, 245, .91))'
  }),
  '07-starlit-arches.jpg': darkTheme('starlit-arches', '#c5a7ff', {
    panel: 'rgba(21, 16, 58, .88)', panelStrong: 'rgba(13, 10, 42, .86)', contentSurface: 'linear-gradient(180deg, rgba(20, 15, 56, .94), rgba(29, 20, 72, .91))'
  }),
  '08-sandstone-arches.jpg': lightTheme('sandstone-arches', '#975823', {
    pageText: '#422b1d', pageMuted: 'rgba(66, 43, 29, .75)', panel: 'rgba(255, 249, 239, .91)', panelStrong: 'rgba(255, 253, 247, .9)', contentSurface: 'linear-gradient(180deg, rgba(255, 252, 245, .95), rgba(249, 240, 226, .92))'
  }),
  '09-burgundy-arabesque.jpg': darkTheme('burgundy-arabesque', '#f0be6c', {
    panel: 'rgba(55, 6, 18, .88)', panelStrong: 'rgba(36, 4, 13, .87)', contentSurface: 'linear-gradient(180deg, rgba(53, 7, 19, .94), rgba(70, 11, 26, .91))', typeScale: 1.02
  }),
  '10-copper-mashrabiya.jpg': darkTheme('copper-mashrabiya', '#e8a56b', {
    panel: 'rgba(11, 24, 38, .89)', panelStrong: 'rgba(6, 16, 29, .87)', contentSurface: 'linear-gradient(180deg, rgba(11, 25, 39, .94), rgba(21, 34, 46, .91))'
  }),
  '11-ivory-gold.jpg': lightTheme('ivory-gold', '#8d681d', {
    pageText: '#392d18', pageMuted: 'rgba(57, 45, 24, .74)', panel: 'rgba(255, 252, 242, .92)', panelStrong: 'rgba(255, 255, 252, .91)', contentSurface: 'linear-gradient(180deg, rgba(255, 254, 248, .96), rgba(249, 244, 230, .93))', typeScale: 1.04, clockWeight: 410
  }),
  '12-sapphire-glass.jpg': darkTheme('sapphire-glass', '#64dcff', {
    panel: 'rgba(5, 21, 54, .88)', panelStrong: 'rgba(3, 13, 38, .87)', contentSurface: 'linear-gradient(180deg, rgba(5, 20, 51, .94), rgba(9, 29, 68, .91))'
  }),
  '13-forest-arabesque.jpg': darkTheme('forest-arabesque', '#d6c776', {
    panel: 'rgba(11, 37, 22, .88)', panelStrong: 'rgba(7, 26, 15, .87)', contentSurface: 'linear-gradient(180deg, rgba(10, 35, 21, .94), rgba(16, 48, 28, .91))', typeScale: 1.02
  }),
  '14-mountain-dawn.jpg': lightTheme('mountain-dawn', '#365f7d', {
    pageText: '#253b4c', pageMuted: 'rgba(37, 59, 76, .73)', panel: 'rgba(248, 252, 253, .91)', panelStrong: 'rgba(253, 255, 255, .9)', contentSurface: 'linear-gradient(180deg, rgba(251, 254, 255, .95), rgba(236, 244, 248, .92))'
  }),
  '15-turquoise-pool.jpg': lightTheme('turquoise-pool', '#087873', {
    pageText: '#123f3d', pageMuted: 'rgba(18, 63, 61, .73)', panel: 'rgba(245, 255, 252, .91)', contentSurface: 'linear-gradient(180deg, rgba(248, 255, 253, .95), rgba(229, 247, 244, .92))', typeScale: 1.02
  }),
  '16-midnight-lanterns.jpg': darkTheme('midnight-lanterns', '#f0b45e', {
    panel: 'rgba(5, 21, 40, .89)', panelStrong: 'rgba(3, 13, 28, .88)', contentSurface: 'linear-gradient(180deg, rgba(5, 20, 38, .95), rgba(9, 29, 48, .92))'
  }),
  '17-moonlit-reflections.jpg': darkTheme('moonlit-reflections', '#79dbe7', {
    panel: 'rgba(7, 29, 43, .87)', panelStrong: 'rgba(4, 20, 33, .86)', contentSurface: 'linear-gradient(180deg, rgba(7, 28, 42, .94), rgba(12, 40, 55, .91))'
  }),
  '18-andalusian-courtyard.jpg': lightTheme('andalusian-courtyard', '#934e38', {
    pageText: '#422d27', pageMuted: 'rgba(66, 45, 39, .73)', panel: 'rgba(255, 250, 245, .91)', contentSurface: 'linear-gradient(180deg, rgba(255, 252, 248, .95), rgba(247, 238, 230, .92))'
  }),
  '19-ottoman-dome.jpg': darkTheme('ottoman-dome', '#d9ba68', {
    panel: 'rgba(13, 24, 39, .89)', panelStrong: 'rgba(8, 15, 28, .88)', contentSurface: 'linear-gradient(180deg, rgba(13, 24, 38, .95), rgba(23, 34, 48, .92))'
  }),
  '20-moroccan-corridor.jpg': lightTheme('moroccan-corridor', '#7d6427', {
    pageText: '#293b34', pageMuted: 'rgba(41, 59, 52, .73)', panel: 'rgba(253, 252, 245, .92)', contentSurface: 'linear-gradient(180deg, rgba(255, 255, 250, .96), rgba(241, 245, 237, .93))', typeScale: 1.04
  }),
  '21-black-gold.jpg': darkTheme('black-gold', '#d8b45f', {
    panel: 'rgba(22, 20, 17, .9)', panelStrong: 'rgba(12, 12, 11, .89)', contentSurface: 'linear-gradient(180deg, rgba(22, 20, 17, .95), rgba(32, 28, 22, .92))', typeScale: 1.02
  }),
  '22-pastel-sunrise.jpg': lightTheme('pastel-sunrise', '#805486', {
    pageText: '#3d2f48', pageMuted: 'rgba(61, 47, 72, .73)', panel: 'rgba(255, 250, 255, .91)', contentSurface: 'linear-gradient(180deg, rgba(255, 252, 255, .95), rgba(246, 237, 249, .92))', typeScale: 1.04, clockWeight: 410
  }),
  '23-purple-twilight.jpg': darkTheme('purple-twilight', '#ff9dce', {
    panel: 'rgba(43, 13, 53, .88)', panelStrong: 'rgba(29, 8, 39, .87)', contentSurface: 'linear-gradient(180deg, rgba(42, 13, 52, .94), rgba(58, 18, 66, .91))'
  }),
  '24-cyan-muqarnas.jpg': darkTheme('cyan-muqarnas', '#52e2dc', {
    panel: 'rgba(4, 34, 42, .88)', panelStrong: 'rgba(2, 23, 30, .87)', contentSurface: 'linear-gradient(180deg, rgba(4, 33, 41, .94), rgba(7, 47, 55, .91))', typeScale: 1.02
  })
};

const DEFAULT_TV_THEME = darkTheme('default-tv', '#42c6d9');
const DEFAULT_WIDGET_THEME = lightTheme('default-widget', '#327c50', { typeScale: 1 });

function imageFileName(imageUrl?: string): string {
  if (!imageUrl) return '';
  try {
    return new URL(imageUrl, 'https://iqamatime.local').pathname.split('/').at(-1)?.toLowerCase() ?? '';
  } catch {
    return imageUrl.split('?')[0].split('/').at(-1)?.toLowerCase() ?? '';
  }
}

function darkOverride(source: PrayerDisplayTheme): PrayerDisplayTheme {
  return darkTheme(`${source.id}-dark`, source.accent, {
    panel: `color-mix(in srgb, ${source.accent} 8%, rgba(5, 15, 20, .92))`,
    panelStrong: `color-mix(in srgb, ${source.accent} 5%, rgba(2, 10, 15, .92))`,
    contentSurface: `linear-gradient(180deg, color-mix(in srgb, ${source.accent} 7%, rgba(5, 17, 18, .95)), rgba(5, 19, 18, .93))`,
    typeScale: Math.max(source.typeScale, 1.02)
  });
}

function classicOverride(source: PrayerDisplayTheme): PrayerDisplayTheme {
  const base = source.mode === 'light'
    ? lightTheme(`${source.id}-classic`, '#a47725')
    : darkTheme(`${source.id}-classic`, '#deb96a');
  return { ...base, typeScale: Math.max(source.typeScale, 1.02), clockWeight: source.mode === 'light' ? 430 : 340 };
}

function alignContentSurfaces(theme: PrayerDisplayTheme): PrayerDisplayTheme {
  return {
    ...theme,
    contentSurfaceStrong: theme.panelStrong,
    contentSurfaceAlt: theme.panelHeader
  };
}

export function prayerDisplayThemeForWallpaperFile(fileName: string): PrayerDisplayTheme {
  return alignContentSurfaces(WALLPAPER_THEMES[fileName.toLowerCase()] ?? DEFAULT_TV_THEME);
}

export function resolvePrayerDisplayTheme(
  imageUrl?: string,
  requestedTheme?: string,
  fallback: PrayerDisplayMode = 'dark'
): PrayerDisplayTheme {
  const selected = WALLPAPER_THEMES[imageFileName(imageUrl)]
    ?? (fallback === 'light' ? DEFAULT_WIDGET_THEME : DEFAULT_TV_THEME);
  const normalized = requestedTheme?.toLowerCase();
  if (normalized === 'dark') return alignContentSurfaces(darkOverride(selected));
  if (normalized === 'classic') return alignContentSurfaces(classicOverride(selected));
  return alignContentSurfaces(selected);
}

export function effectivePrayerDisplayAccent(theme: PrayerDisplayTheme, configuredAccent?: string): string {
  const normalized = configuredAccent?.trim().toLowerCase();
  const systemDefaults = new Set(['#00aeef', '#42c6d9', '#3d8b63']);
  return normalized && !systemDefaults.has(normalized) ? configuredAccent!.trim() : theme.accent;
}

export function prayerDisplayThemeCssVars(
  theme: PrayerDisplayTheme,
  configuredAccent?: string
): Record<string, string> {
  return {
    '--accent': effectivePrayerDisplayAccent(theme, configuredAccent),
    '--display-page-text': theme.pageText,
    '--display-page-muted': theme.pageMuted,
    '--display-page-faint': theme.pageFaint,
    '--display-overlay': theme.overlay,
    '--display-hero-overlay': theme.heroOverlay,
    '--display-panel': theme.panel,
    '--display-panel-strong': theme.panelStrong,
    '--display-panel-header': theme.panelHeader,
    '--display-panel-border': theme.panelBorder,
    '--display-panel-text': theme.panelText,
    '--display-panel-muted': theme.panelMuted,
    '--display-content-surface': theme.contentSurface,
    '--display-content-strong': theme.contentSurfaceStrong,
    '--display-content-alt': theme.contentSurfaceAlt,
    '--display-row-border': theme.rowBorder,
    '--display-shadow': theme.shadow,
    '--display-text-shadow': theme.textShadow,
    '--display-type-scale': String(theme.typeScale),
    '--display-clock-weight': String(theme.clockWeight)
  };
}
