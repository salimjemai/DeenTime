import { NgStyle } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { PrayerTimesDto, PublicDisplay } from '../../models';
import { PublicDisplayOptions, PublicDisplayService } from '../../services/public-display';
import {
  effectivePrayerDisplayAccent,
  prayerDisplayThemeCssVars,
  resolvePrayerDisplayTheme
} from '../../shared/prayer-display-theme';

export type PrayerKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export type FeaturedPrayerPhase = 'current' | 'upcoming';

const ACTIVE_PRAYERS: PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const JUMUAH_ORDER = ['Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'];
const ARABIC_HIJRI_MONTHS = [
  'مُحَرَّم', 'صَفَر', 'رَبِيع ٱلْأَوَّل', 'رَبِيع ٱلْآخِر',
  'جُمَادَىٰ ٱلْأُولَىٰ', 'جُمَادَىٰ ٱلْآخِرَة', 'رَجَب', 'شَعْبَان',
  'رَمَضَان', 'شَوَّال', 'ذُو ٱلْقَعْدَة', 'ذُو ٱلْحِجَّة'
] as const;

function parsePrayerMinutes(value: string | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function formatTvTime(value: string | undefined): string {
  if (!value) return '—';
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const period = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function visibleJumuahEntriesAt(
  entries: PublicDisplay['iqama'],
  isFriday: boolean,
  nowMinutes: number
): PublicDisplay['iqama'] {
  const scheduled = entries
    .filter(item => JUMUAH_ORDER.includes(item.salah))
    .sort((left, right) => JUMUAH_ORDER.indexOf(left.salah) - JUMUAH_ORDER.indexOf(right.salah));
  if (!isFriday) return scheduled;

  return scheduled.filter(entry => {
    const serviceEnd = parsePrayerMinutes(entry.salahTime) ?? parsePrayerMinutes(entry.time);
    return serviceEnd === null || serviceEnd >= nowMinutes;
  });
}

export function featuredPrayerAt(timings: PrayerTimesDto | null, nowMinutes: number): { key: PrayerKey; phase: FeaturedPrayerPhase } | null {
  if (!timings) return null;
  const schedule = ACTIVE_PRAYERS
    .map(key => ({ key, minutes: parsePrayerMinutes(timings[key]) }))
    .filter((entry): entry is { key: PrayerKey; minutes: number } => entry.minutes !== null)
    .sort((left, right) => left.minutes - right.minutes);
  if (!schedule.length) return null;

  const previous = [...schedule].reverse().find(entry => entry.minutes <= nowMinutes)
    ?? { ...schedule[schedule.length - 1], minutes: schedule[schedule.length - 1].minutes - 1440 };
  const next = schedule.find(entry => entry.minutes > nowMinutes)
    ?? { ...schedule[0], minutes: schedule[0].minutes + 1440 };

  return nowMinutes >= next.minutes - 15
    ? { key: next.key, phase: 'upcoming' }
    : { key: previous.key, phase: 'current' };
}

export function formatTvClock(now: Date, timeZone: string | undefined, showSeconds: boolean) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    hour12: true
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>;
  return `${value['hour'] ?? ''}:${value['minute'] ?? ''}${showSeconds ? `:${value['second'] ?? '00'}` : ''} ${(value['dayPeriod'] ?? '').toUpperCase()}`.trim();
}

export function fittedClockFontSize(desiredSize: number, naturalWidth: number, availableWidth: number) {
  if (![desiredSize, naturalWidth, availableWidth].every(Number.isFinite)
    || desiredSize <= 0 || naturalWidth <= 0 || availableWidth <= 0
    || naturalWidth <= availableWidth) return desiredSize;
  return desiredSize * (availableWidth / naturalWidth) * 0.985;
}

export function formatArabicHijriDate(day: number, month: number, year: number) {
  const numerals = (value: number) => String(value).replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
  const monthName = ARABIC_HIJRI_MONTHS[month - 1] ?? '';
  return `${numerals(day)} ${monthName} ${numerals(year)} هـ`.trim();
}

@Component({
  selector: 'app-tv',
  standalone: true,
  imports: [NgStyle, MatProgressSpinnerModule, MatIconModule],
  templateUrl: './tv.html',
  styleUrl: './tv.scss'
})
export class TvComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private displayService = inject(PublicDisplayService);

  slug = this.route.snapshot.params['slug'];
  display = signal<PublicDisplay | null>(null);
  timings = signal<PrayerTimesDto | null>(null);
  clockDisplay = signal('');
  featuredPrayer = signal<{ key: PrayerKey; phase: FeaturedPrayerPhase } | null>(null);
  localNowMinutes = signal(0);
  isLocalFriday = signal(false);
  loading = signal(true);
  backgroundImageUrl = computed(() => this.display()?.design?.backgroundImageUrl ?? this.display()?.design?.headerImageUrl ?? '');
  displayTheme = computed(() => resolvePrayerDisplayTheme(
    this.backgroundImageUrl(),
    this.display()?.design?.theme,
    'dark'
  ));
  displayThemeStyles = computed(() => prayerDisplayThemeCssVars(
    this.displayTheme(),
    this.display()?.tvConfig?.accentColor
  ));

  prayers: { key: PrayerKey; salah?: string; label: string; detail: string }[] = [
    { key: 'fajr', salah: 'Fajr', label: 'Fajr', detail: 'Dawn' },
    { key: 'sunrise', label: 'Sunrise', detail: 'Shuruq' },
    { key: 'dhuhr', salah: 'Dhuhr', label: 'Dhuhr', detail: 'Noon' },
    { key: 'asr', salah: 'Asr', label: 'Asr', detail: 'Afternoon' },
    { key: 'maghrib', salah: 'Maghrib', label: 'Maghrib', detail: 'Sunset' },
    { key: 'isha', salah: 'Isha', label: 'Isha', detail: 'Night' }
  ];

  private clockInterval?: ReturnType<typeof setInterval>;
  private refreshInterval?: ReturnType<typeof setInterval>;
  private clockPanelElement?: HTMLElement;
  private clockTextElement?: HTMLElement;
  private clockResizeObserver?: ResizeObserver;
  private clockFitFrame?: number;
  private observedClockWidth = 0;

  @ViewChild('clockPanel')
  set clockPanelRef(value: ElementRef<HTMLElement> | undefined) {
    this.clockPanelElement = value?.nativeElement;
    this.connectClockFitting();
  }

  @ViewChild('clockText')
  set clockTextRef(value: ElementRef<HTMLElement> | undefined) {
    this.clockTextElement = value?.nativeElement;
    this.connectClockFitting();
  }

  ngOnInit() {
    this.loadTimings();
    this.clockInterval = setInterval(() => this.updateClock(), 1000);
    this.updateClock();
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
    this.clockResizeObserver?.disconnect();
    if (this.clockFitFrame !== undefined) cancelAnimationFrame(this.clockFitFrame);
  }

  private loadTimings() {
    const options = this.displayOptions();
    const request = Object.keys(options).length
      ? this.displayService.get(this.slug, 'tv', options)
      : this.displayService.get(this.slug, 'tv');
    request.subscribe({
      next: display => {
        this.display.set(display);
        this.timings.set(display.timings ?? null);
        this.configureRefresh(display.tvConfig?.autoRefreshSeconds ?? 60);
        this.updateClock();
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  private displayOptions(): PublicDisplayOptions {
    const query = this.route.snapshot.queryParamMap;
    if (!query) return {};
    const options: PublicDisplayOptions = {};
    const locale = query.get('locale');
    const theme = query.get('theme');
    const fontScale = query.get('fontScale');
    if (locale) options.locale = locale;
    if (theme) options.theme = theme;
    if (fontScale) options.fontScale = fontScale;
    return options;
  }

  private updateClock() {
    const now = new Date();
    const timeZone = this.display()?.timezoneId || undefined;
    const showSeconds = this.display()?.tvConfig?.showSeconds ?? true;
    this.clockDisplay.set(formatTvClock(now, timeZone, showSeconds));
    this.scheduleClockFit();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>;
    const nowMinutes = Number(value['hour'] ?? 0) * 60
      + Number(value['minute'] ?? 0)
      + Number(value['second'] ?? 0) / 60;
    this.localNowMinutes.set(nowMinutes);
    this.isLocalFriday.set(value['weekday'] === 'Fri');
    this.featuredPrayer.set(featuredPrayerAt(this.timings(), nowMinutes));
  }

  private connectClockFitting() {
    this.clockResizeObserver?.disconnect();
    if (!this.clockPanelElement || !this.clockTextElement) return;
    this.observedClockWidth = 0;
    this.clockResizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(width - this.observedClockWidth) < 0.5) return;
      this.observedClockWidth = width;
      this.scheduleClockFit();
    });
    this.clockResizeObserver.observe(this.clockPanelElement);
    this.scheduleClockFit();
  }

  private scheduleClockFit() {
    if (!this.clockPanelElement || !this.clockTextElement) return;
    if (this.clockFitFrame !== undefined) cancelAnimationFrame(this.clockFitFrame);
    this.clockFitFrame = requestAnimationFrame(() => {
      this.clockFitFrame = undefined;
      this.fitClockToPanel();
    });
  }

  private fitClockToPanel() {
    const text = this.clockTextElement;
    const clock = text?.parentElement;
    if (!text || !clock) return;

    text.style.removeProperty('font-size');
    const desiredSize = Number.parseFloat(getComputedStyle(text).fontSize);
    const naturalWidth = Math.max(text.scrollWidth, text.getBoundingClientRect().width);
    const fittedSize = fittedClockFontSize(desiredSize, naturalWidth, clock.clientWidth);
    if (fittedSize < desiredSize - 0.1) text.style.fontSize = `${fittedSize}px`;
  }

  private configureRefresh(seconds: number) {
    clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this.loadTimings(), Math.max(15, seconds) * 1000);
  }

  timeFor(key: PrayerKey): string {
    const timings = this.timings();
    return timings ? this.formatTime(timings[key]) : '—';
  }

  iqamaFor(salah: string | undefined): string {
    if (!salah) return '—';
    const entry = this.display()?.iqama.find(item => item.salah === salah);
    if (!entry) return 'Not set';
    if (entry.time) return this.formatTime(entry.time);
    return entry.offsetMinutes !== undefined ? `+${entry.offsetMinutes} min` : 'Not set';
  }

  hasIqama(salah: string | undefined): boolean {
    return !!salah && !!this.display()?.iqama.some(item => item.salah === salah);
  }

  jumuahEntries() {
    return visibleJumuahEntriesAt(this.display()?.iqama ?? [], this.isLocalFriday(), this.localNowMinutes());
  }

  allJumuahEntries() {
    return visibleJumuahEntriesAt(this.display()?.iqama ?? [], false, this.localNowMinutes());
  }

  isCurrentJumuah(entry: PublicDisplay['iqama'][number]) {
    if (!this.isLocalFriday()) return false;
    const start = parsePrayerMinutes(entry.time);
    const end = parsePrayerMinutes(entry.salahTime) ?? start;
    return start !== null && end !== null && this.localNowMinutes() >= start && this.localNowMinutes() <= end;
  }

  jumuahLabel(salah: string) {
    return ({ Jumuah: '1st Friday', Jumuah2nd: '2nd Friday', Jumuah3rd: '3rd Friday', Jumuah4th: '4th Friday' } as Record<string, string>)[salah] ?? salah;
  }

  accentColor() {
    return effectivePrayerDisplayAccent(this.displayTheme(), this.display()?.tvConfig?.accentColor);
  }

  showHijri() { return (this.display()?.tvConfig?.showHijri ?? true) && !!this.display()?.hijri; }

  hijriArabicLabel() {
    const hijri = this.display()?.hijri;
    return hijri ? formatArabicHijriDate(hijri.day, hijri.month, hijri.year) : '';
  }

  prayerPhase(key: PrayerKey) {
    const featured = this.featuredPrayer();
    return featured?.key === key ? featured.phase : null;
  }

  dateLabel() {
    const value = this.display()?.date;
    return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  }

  locationLabel() {
    const organization = this.display()?.organization;
    return organization ? [organization.city, organization.state].filter(Boolean).join(', ') : '';
  }

  heroBackground() {
    const image = this.backgroundImageUrl();
    return image ? `url("${image}")` : '';
  }

  formatTime(value: string | undefined): string {
    return formatTvTime(value);
  }
}
