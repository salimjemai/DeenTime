import { NgStyle } from '@angular/common';
import { AfterViewInit, Component, computed, ElementRef, HostListener, inject, signal, OnDestroy, OnInit } from '@angular/core';
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

type WidgetVariant = 'full' | 'compact';
type WidgetContent = 'combined' | 'daily' | 'jumuah';

@Component({
  selector: 'app-widget',
  standalone: true,
  imports: [NgStyle, MatProgressSpinnerModule, MatIconModule],
  templateUrl: './widget.html',
  styleUrl: './widget.scss'
})
export class WidgetComponent implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private displayService = inject(PublicDisplayService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private resizeObserver?: ResizeObserver;

  slug = this.route.snapshot.params['slug'];
  variant = (this.route.snapshot.data['variant'] ?? 'full') as WidgetVariant;
  contentMode = (this.route.snapshot.data['content'] ?? 'combined') as WidgetContent;
  display = signal<PublicDisplay | null>(null);
  timings = signal<PrayerTimesDto | null>(null);
  loading = signal(true);
  error = signal(false);
  backgroundImageUrl = computed(() => this.display()?.design?.backgroundImageUrl ?? this.display()?.design?.headerImageUrl ?? '');
  displayTheme = computed(() => resolvePrayerDisplayTheme(
    this.backgroundImageUrl(),
    this.display()?.design?.theme,
    'light'
  ));
  displayThemeStyles = computed(() => prayerDisplayThemeCssVars(
    this.displayTheme(),
    this.display()?.tvConfig?.accentColor
  ));

  prayers = [
    { key: 'fajr', salah: 'Fajr', label: 'Fajr', detail: 'Dawn' },
    { key: 'sunrise', salah: '', label: 'Sunrise', detail: 'Shuruq' },
    { key: 'dhuhr', salah: 'Dhuhr', label: 'Dhuhr', detail: 'Noon' },
    { key: 'asr', salah: 'Asr', label: 'Asr', detail: 'Afternoon' },
    { key: 'maghrib', salah: 'Maghrib', label: 'Maghrib', detail: 'Sunset' },
    { key: 'isha', salah: 'Isha', label: 'Isha', detail: 'Night' }
  ];

  ngOnInit() {
    const options = this.displayOptions();
    const layout = this.variant === 'compact' ? 'compact' : 'widget';
    const request = Object.keys(options).length
      ? this.displayService.get(this.slug, layout, options)
      : this.displayService.get(this.slug, layout);
    request.subscribe({
      next: display => {
        this.display.set(display);
        this.timings.set(display.timings ?? null);
        this.loading.set(false);
      },
      error: () => { this.error.set(true); this.loading.set(false); }
    });
  }

  ngAfterViewInit() {
    if (typeof ResizeObserver === 'undefined' || typeof window === 'undefined') return;
    const widget = this.host.nativeElement.querySelector<HTMLElement>('.widget');
    if (!widget) return;
    this.resizeObserver = new ResizeObserver(() => this.publishHeight());
    this.resizeObserver.observe(widget);
    window.requestAnimationFrame(() => this.publishHeight());
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  @HostListener('window:message', ['$event'])
  onMeasurementRequest(event: MessageEvent) {
    if (event.data?.type !== 'iqamatime:measure-widget') return;
    this.publishHeight(event.source as WindowProxy | null, event.origin);
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

  timeFor(key: string): string {
    const timings = this.timings();
    return timings ? this.formatTime(timings[key as keyof PrayerTimesDto]) : '—';
  }

  iqamaFor(salah: string): string {
    if (!salah) return '—';
    const entry = this.display()?.iqama.find(item => item.salah === salah);
    if (!entry) return '—';
    if (entry.time) return this.formatTime(entry.time);
    return entry.offsetMinutes !== undefined ? `+${entry.offsetMinutes} min` : '—';
  }

  jumuahEntries() {
    const order = ['Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'];
    return (this.display()?.iqama ?? [])
      .filter(item => order.includes(item.salah))
      .sort((a, b) => order.indexOf(a.salah) - order.indexOf(b.salah));
  }

  jumuahLabel(salah: string) {
    return ({ Jumuah: 'First', Jumuah2nd: 'Second', Jumuah3rd: 'Third', Jumuah4th: 'Fourth' } as Record<string, string>)[salah] ?? salah;
  }

  showDaily() { return this.contentMode !== 'jumuah'; }

  showJumuah() { return this.contentMode !== 'daily'; }

  widgetEyebrow() {
    if (this.contentMode === 'daily') return 'DAILY PRAYER TIMES';
    if (this.contentMode === 'jumuah') return 'FRIDAY PRAYERS';
    return 'DAILY + FRIDAY PRAYERS';
  }

  accentColor() {
    return effectivePrayerDisplayAccent(this.displayTheme(), this.display()?.tvConfig?.accentColor);
  }

  fontScale() {
    const design = this.display()?.design;
    return this.variant === 'compact' ? design?.compactFontScale ?? 100 : design?.widgetFontScale ?? 100;
  }

  fontFamily() {
    const design = this.display()?.design;
    return this.variant === 'compact' ? design?.compactFontFamily ?? 'system' : design?.widgetFontFamily ?? 'system';
  }

  backgroundImage() {
    const image = this.backgroundImageUrl();
    return image ? `url("${image}")` : '';
  }

  dateLabel() {
    const value = this.display()?.date;
    return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  }

  locationLabel() {
    const organization = this.display()?.organization;
    return organization ? [organization.city, organization.state].filter(Boolean).join(', ') : '';
  }

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}`;
  }

  private publishHeight(target: WindowProxy | null = window.parent, targetOrigin = '*') {
    if (!target || typeof window === 'undefined') return;
    const widget = this.host.nativeElement.querySelector<HTMLElement>('.widget');
    if (!widget) return;
    const height = Math.ceil(widget.getBoundingClientRect().height + 24);
    target.postMessage({
      type: 'iqamatime:widget-resize',
      slug: this.slug,
      variant: this.variant,
      content: this.contentMode,
      height
    }, targetOrigin || '*');
  }
}
