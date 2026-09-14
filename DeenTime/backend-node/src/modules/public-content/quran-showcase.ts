/**
 * FindAyah from PublicIslamicContentController.cs: locates an ayah by its global
 * number inside a cached complete-edition payload (/quran/{edition}) and returns
 * it with the edition and a trimmed surah descriptor attached.
 */
export type AyahRecord = Record<string, unknown>;

function asObject(value: unknown): AyahRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as AyahRecord) : null;
}

export function findAyah(payload: unknown, number: number): AyahRecord | null {
  const data = asObject(asObject(payload)?.data);
  const surahs = data?.surahs;
  const edition = data?.edition;
  if (!Array.isArray(surahs) || edition === undefined || edition === null) return null;

  for (const surahNode of surahs) {
    const surah = asObject(surahNode);
    const ayahs = surah?.ayahs;
    if (surah === null || !Array.isArray(ayahs)) continue;

    for (const ayahNode of ayahs) {
      const ayah = asObject(ayahNode);
      if (ayah === null || ayah.number !== number) continue;

      const result: AyahRecord = structuredClone(ayah);
      result.edition = structuredClone(edition);
      result.surah = {
        number: structuredClone(surah.number ?? null),
        name: structuredClone(surah.name ?? null),
        englishName: structuredClone(surah.englishName ?? null),
        englishNameTranslation: structuredClone(surah.englishNameTranslation ?? null),
        revelationType: structuredClone(surah.revelationType ?? null),
      };
      return result;
    }
  }
  return null;
}

export const AYAH_COUNT = 6236;
