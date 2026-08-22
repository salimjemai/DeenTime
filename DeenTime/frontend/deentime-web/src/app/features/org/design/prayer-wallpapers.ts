import { PrayerDisplayTheme, prayerDisplayThemeForWallpaperFile } from '../../../shared/prayer-display-theme';

export type PrayerWallpaperCategory = 'Geometric' | 'Architecture' | 'Celestial' | 'Light';

export interface PrayerWallpaper {
  id: string;
  name: string;
  category: PrayerWallpaperCategory;
  src: string;
  thumbnail: string;
  displayTheme: PrayerDisplayTheme;
}

const wallpaper = (
  id: string,
  name: string,
  category: PrayerWallpaperCategory,
  fileName: string
): PrayerWallpaper => ({
  id,
  name,
  category,
  src: `/wallpapers/islamic/full/${fileName}`,
  thumbnail: `/wallpapers/islamic/thumbs/${fileName}`,
  displayTheme: prayerDisplayThemeForWallpaperFile(fileName)
});

export const PRAYER_WALLPAPERS: readonly PrayerWallpaper[] = [
  wallpaper('midnight-lattice', 'Midnight Lattice', 'Geometric', '01-midnight-lattice.jpg'),
  wallpaper('turquoise-zellige', 'Turquoise Zellige', 'Geometric', '02-turquoise-zellige.jpg'),
  wallpaper('emerald-mihrab', 'Emerald Mihrab', 'Architecture', '03-emerald-mihrab.jpg'),
  wallpaper('blue-hour-courtyard', 'Blue Hour Courtyard', 'Architecture', '04-blue-hour-courtyard.jpg'),
  wallpaper('desert-crescent', 'Desert Crescent', 'Celestial', '05-desert-crescent.jpg'),
  wallpaper('dawn-silhouette', 'Dawn Silhouette', 'Celestial', '06-dawn-silhouette.jpg'),
  wallpaper('starlit-arches', 'Starlit Arches', 'Celestial', '07-starlit-arches.jpg'),
  wallpaper('sandstone-arches', 'Sandstone Arches', 'Architecture', '08-sandstone-arches.jpg'),
  wallpaper('burgundy-arabesque', 'Burgundy Arabesque', 'Geometric', '09-burgundy-arabesque.jpg'),
  wallpaper('copper-mashrabiya', 'Copper Mashrabiya', 'Architecture', '10-copper-mashrabiya.jpg'),
  wallpaper('ivory-gold', 'Ivory & Gold', 'Light', '11-ivory-gold.jpg'),
  wallpaper('sapphire-glass', 'Sapphire Glass', 'Geometric', '12-sapphire-glass.jpg'),
  wallpaper('forest-arabesque', 'Forest Arabesque', 'Geometric', '13-forest-arabesque.jpg'),
  wallpaper('mountain-dawn', 'Mountain Dawn', 'Light', '14-mountain-dawn.jpg'),
  wallpaper('turquoise-pool', 'Turquoise Pool', 'Architecture', '15-turquoise-pool.jpg'),
  wallpaper('midnight-lanterns', 'Midnight Lanterns', 'Celestial', '16-midnight-lanterns.jpg'),
  wallpaper('moonlit-reflections', 'Moonlit Reflections', 'Celestial', '17-moonlit-reflections.jpg'),
  wallpaper('andalusian-courtyard', 'Andalusian Courtyard', 'Architecture', '18-andalusian-courtyard.jpg'),
  wallpaper('ottoman-dome', 'Ottoman Dome', 'Architecture', '19-ottoman-dome.jpg'),
  wallpaper('moroccan-corridor', 'Moroccan Corridor', 'Architecture', '20-moroccan-corridor.jpg'),
  wallpaper('black-gold', 'Black & Gold', 'Geometric', '21-black-gold.jpg'),
  wallpaper('pastel-sunrise', 'Pastel Sunrise', 'Light', '22-pastel-sunrise.jpg'),
  wallpaper('purple-twilight', 'Purple Twilight', 'Celestial', '23-purple-twilight.jpg'),
  wallpaper('cyan-muqarnas', 'Cyan Muqarnas', 'Geometric', '24-cyan-muqarnas.jpg')
];

export const PRAYER_WALLPAPER_CATEGORIES = [
  'All',
  'Geometric',
  'Architecture',
  'Celestial',
  'Light'
] as const;

export type PrayerWallpaperFilter = typeof PRAYER_WALLPAPER_CATEGORIES[number];
