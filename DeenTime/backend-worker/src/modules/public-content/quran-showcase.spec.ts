import { describe, expect, it } from 'vitest';
import { findAyah } from './quran-showcase.js';

const payload = {
  code: 200,
  status: 'OK',
  data: {
    number: 114,
    edition: { identifier: 'quran-uthmani', language: 'ar', name: 'Uthmani', format: 'text', type: 'quran' },
    surahs: [
      {
        number: 1,
        name: 'سُورَةُ ٱلْفَاتِحَةِ',
        englishName: 'Al-Faatiha',
        englishNameTranslation: 'The Opening',
        revelationType: 'Meccan',
        ayahs: [
          { number: 1, text: 'بِسْمِ ٱللَّهِ', numberInSurah: 1, juz: 1, sajda: false },
          { number: 2, text: 'ٱلْحَمْدُ لِلَّهِ', numberInSurah: 2, juz: 1, sajda: false },
        ],
      },
      { number: 2, name: 'سُورَةُ البَقَرَةِ', englishName: 'Al-Baqara', ayahs: [{ number: 8, text: 'x', numberInSurah: 1, juz: 1, sajda: false }] },
    ],
  },
};

describe('findAyah', () => {
  it('returns the ayah with the edition and a trimmed surah descriptor', () => {
    const ayah = findAyah(payload, 2);
    expect(ayah).toEqual({
      number: 2,
      text: 'ٱلْحَمْدُ لِلَّهِ',
      numberInSurah: 2,
      juz: 1,
      sajda: false,
      edition: payload.data.edition,
      surah: { number: 1, name: 'سُورَةُ ٱلْفَاتِحَةِ', englishName: 'Al-Faatiha', englishNameTranslation: 'The Opening', revelationType: 'Meccan' },
    });
    expect(Object.keys(ayah ?? {})).toEqual(['number', 'text', 'numberInSurah', 'juz', 'sajda', 'edition', 'surah']);
  });

  it('fills missing surah fields with null and does not mutate the payload', () => {
    const ayah = findAyah(payload, 8);
    expect(ayah?.surah).toEqual({ number: 2, name: 'سُورَةُ البَقَرَةِ', englishName: 'Al-Baqara', englishNameTranslation: null, revelationType: null });
    expect(payload.data.surahs[1]).not.toHaveProperty('edition');
  });

  it('returns null for unknown numbers or payloads without surahs', () => {
    expect(findAyah(payload, 3)).toBeNull();
    expect(findAyah({ data: { edition: {} } }, 1)).toBeNull();
    expect(findAyah({ data: { surahs: [] } }, 1)).toBeNull();
    expect(findAyah('not an object', 1)).toBeNull();
    expect(findAyah(null, 1)).toBeNull();
  });
});
