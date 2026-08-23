import { PrayerTimesDto } from '../../models';
import { featuredPrayerAt, fittedClockFontSize, formatArabicHijriDate, formatTvClock, formatTvTime, visibleJumuahEntriesAt } from './tv';

describe('TV display time presentation', () => {
  const timings = {
    date: '2026-08-19',
    fajr: '05:50:00',
    sunrise: '07:00:00',
    dhuhr: '13:40:00',
    asr: '17:11:00',
    maghrib: '20:10:00',
    sunset: '20:10:00',
    isha: '21:20:00'
  } as PrayerTimesDto;

  it('keeps hours, minutes, seconds, and period on one horizontal clock line', () => {
    const now = new Date('2026-08-19T18:07:04Z');
    expect(formatTvClock(now, 'America/Chicago', true)).toBe('01:07:04 PM');
    expect(formatTvClock(now, 'America/Chicago', false)).toBe('01:07 PM');
  });

  it('fits an enlarged clock into its panel instead of clipping AM or PM', () => {
    expect(fittedClockFontSize(288, 1396, 1010)).toBeCloseTo(205.2, 1);
    expect(fittedClockFontSize(160, 700, 900)).toBe(160);
  });

  it('raises the current prayer until 15 minutes before the next Adhan', () => {
    expect(featuredPrayerAt(timings, 13 * 60 + 7)).toEqual({ key: 'fajr', phase: 'current' });
    expect(featuredPrayerAt(timings, 13 * 60 + 25)).toEqual({ key: 'dhuhr', phase: 'upcoming' });
    expect(featuredPrayerAt(timings, 13 * 60 + 40)).toEqual({ key: 'dhuhr', phase: 'current' });
    expect(featuredPrayerAt(timings, 16 * 60 + 56)).toEqual({ key: 'asr', phase: 'upcoming' });
  });

  it('shows the Hijri date on a translated Arabic line', () => {
    expect(formatArabicHijriDate(6, 3, 1448)).toBe('٦ رَبِيع ٱلْأَوَّل ١٤٤٨ هـ');
  });

  it('includes AM or PM on every displayed prayer time', () => {
    expect(formatTvTime('05:53')).toBe('5:53 AM');
    expect(formatTvTime('13:20')).toBe('1:20 PM');
  });

  it('keeps only the current and future Friday services once Friday prayers begin', () => {
    const services = [
      { salah: 'Jumuah', time: '12:00', salahTime: '12:20' },
      { salah: 'Jumuah2nd', time: '13:00', salahTime: '13:20' },
      { salah: 'Jumuah3rd', time: '14:00', salahTime: '14:20' },
      { salah: 'Jumuah4th', time: '15:00', salahTime: '15:20' }
    ];

    expect(visibleJumuahEntriesAt(services, false, 14 * 60).map(entry => entry.salah)).toHaveSize(4);
    expect(visibleJumuahEntriesAt(services, true, 12 * 60 + 10).map(entry => entry.salah)).toEqual([
      'Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'
    ]);
    expect(visibleJumuahEntriesAt(services, true, 12 * 60 + 21).map(entry => entry.salah)).toEqual([
      'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'
    ]);
    expect(visibleJumuahEntriesAt(services, true, 15 * 60 + 21)).toEqual([]);
  });
});
