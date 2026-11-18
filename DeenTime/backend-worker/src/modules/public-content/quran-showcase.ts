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

/** The editions the showcase shows together: Arabic text, English translation, recitation. */
export const SHOWCASE_EDITIONS: readonly string[] = ['quran-uthmani', 'en.sahih', 'ar.alafasy'];

/** Cache key of the documented provider endpoint /ayah/{number}/{edition}. */
export function ayahCacheKey(number: number, edition: string): string {
  return `/ayah/${number}/${edition}`;
}

/**
 * A Worker cannot hold or parse a complete edition (/quran/{edition} is larger than a D1
 * row and than the CPU budget), so the showcase reads one row per ayah, stored under the
 * provider's own /ayah/{number}/{edition} key. This turns such a payload into what
 * findAyah returned: the ayah with its edition and the trimmed surah descriptor.
 */
export function showcaseAyah(payload: unknown): AyahRecord | null {
  const ayah = asObject(asObject(payload)?.data);
  const surah = asObject(ayah?.surah);
  if (ayah === null || surah === null || typeof ayah.number !== 'number' || ayah.edition === undefined || ayah.edition === null) return null;
  return {
    ...ayah,
    surah: {
      number: surah.number ?? null,
      name: surah.name ?? null,
      englishName: surah.englishName ?? null,
      englishNameTranslation: surah.englishNameTranslation ?? null,
      revelationType: surah.revelationType ?? null,
    },
  };
}

export interface AyahPayload {
  number: number;
  /** The /ayah/{number}/{edition} response body: {"code":200,"status":"OK","data":{...}}. */
  json: string;
}

/**
 * Splits a complete-edition payload (/quran/{edition}) into one provider-shaped
 * /ayah/{number}/{edition} payload per ayah (used by the offline sync). Returns null
 * when the payload is not a complete edition.
 */
export function splitEditionIntoAyahs(payload: unknown): AyahPayload[] | null {
  const data = asObject(asObject(payload)?.data);
  const surahs = data?.surahs;
  const edition = data?.edition;
  if (!Array.isArray(surahs) || edition === undefined || edition === null) return null;

  const result: AyahPayload[] = [];
  for (const surahNode of surahs) {
    const surah = asObject(surahNode);
    const ayahs = surah?.ayahs;
    if (surah === null || !Array.isArray(ayahs)) continue;
    const descriptor = {
      number: surah.number ?? null,
      name: surah.name ?? null,
      englishName: surah.englishName ?? null,
      englishNameTranslation: surah.englishNameTranslation ?? null,
      numberOfAyahs: ayahs.length,
      revelationType: surah.revelationType ?? null,
    };
    for (const ayahNode of ayahs) {
      const ayah = asObject(ayahNode);
      if (ayah === null || typeof ayah.number !== 'number') continue;
      result.push({ number: ayah.number, json: JSON.stringify({ code: 200, status: 'OK', data: { ...ayah, edition, surah: descriptor } }) });
    }
  }
  return result;
}
