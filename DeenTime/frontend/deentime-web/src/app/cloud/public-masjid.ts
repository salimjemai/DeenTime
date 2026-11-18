import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { BRAND } from '../brand';
import { MasjidApiService, PublicMasjid, SALAH } from './masjid-api.service';
import { errorMessage } from './shared-auth.contract';

/** Public masjid page at /masjid/m/:slug; ?embed=1 is the compact widget for iframes. */
@Component({
  selector: 'app-public-masjid',
  standalone: true,
  template: `
    <div class="public" [class.dark]="data()?.masjid?.widget?.theme === 'dark'" [class.embed]="embed" [style.--accent]="data()?.masjid?.widget?.accent ?? '#0f766e'">
      @if (error()) {
        <p>{{ error() }}</p>
      } @else if (data(); as d) {
        <header>
          <h1>{{ d.masjid.name }}</h1>
          @if (!embed && (d.masjid.addressLine || d.masjid.city)) {
            <p class="sub">{{ d.masjid.addressLine }}{{ d.masjid.addressLine && d.masjid.city ? ', ' : '' }}{{ d.masjid.city }} {{ d.masjid.region }}</p>
          }
          <p class="sub">{{ dateLabel() }}</p>
        </header>

        @if (d.prayerTimes; as t) {
          <table>
            <thead><tr><th>Prayer</th><th>Adhan</th>@if (showIqama()) {<th>Iqama</th>}</tr></thead>
            <tbody>
              @for (p of rows; track p.key) {
                <tr>
                  <td>{{ p.label }}</td>
                  <td>{{ clock(t[p.key]) }}</td>
                  @if (showIqama()) { <td>{{ d.iqama[p.key] ? clock(d.iqama[p.key]!) : '—' }}</td> }
                </tr>
                @if (p.key === 'fajr') {
                  <tr class="muted-row"><td>Sunrise</td><td>{{ clock(t.sunrise) }}</td>@if (showIqama()) {<td></td>}</tr>
                }
              }
            </tbody>
          </table>
        } @else {
          <p class="sub">Prayer times will appear once the masjid's location is set.</p>
        }

        @if (d.masjid.widget.showJumuah && d.masjid.jumuah.length) {
          <p class="jumuah"><strong>Jumu'ah</strong> {{ jumuahLabel() }}</p>
        }

        @if (d.masjid.widget.showMessages && d.messages.length) {
          <section class="messages">
            @for (m of d.messages; track m.id) {
              <article><strong>{{ m.title }}</strong>@if (m.body) {<p>{{ m.body }}</p>}</article>
            }
          </section>
        }

        @if (!embed) {
          <footer>
            @if (d.masjid.websiteUrl) { <a [href]="d.masjid.websiteUrl" target="_blank" rel="noopener">Website</a> }
            @if (d.masjid.phone) { <a [href]="'tel:' + d.masjid.phone">{{ d.masjid.phone }}</a> }
            <span>{{ brand.name }}</span>
          </footer>
        }
      }
    </div>`,
  styles: [`
    :host { display: block; }
    .public { --accent: #0f766e; min-height: 100vh; padding: 24px 16px; background: #fbf9f3; color: #173429; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .public.embed { min-height: 0; padding: 14px; }
    .public.dark { background: #0d1f1a; color: #eef6f2; }
    header, table, .messages, .jumuah, footer { width: min(520px, 100%); margin: 0 auto; }
    h1 { margin: 0; font-size: 1.5rem; color: var(--accent); }
    .dark h1 { filter: brightness(1.4); }
    .sub { margin: 4px 0; opacity: .75; }
    table { margin-top: 16px; border-collapse: collapse; }
    th, td { padding: 10px 8px; border-bottom: 1px solid rgba(127, 127, 127, .2); text-align: left; }
    th { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
    td:not(:first-child), th:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
    .muted-row td { opacity: .6; font-size: .9rem; }
    .jumuah { margin-top: 14px; }
    .messages article { margin-top: 12px; padding: 12px; border-left: 4px solid var(--accent); border-radius: 8px; background: rgba(127, 127, 127, .08); }
    .messages p { margin: 4px 0 0; white-space: pre-line; }
    footer { display: flex; gap: 16px; margin-top: 24px; font-size: .9rem; opacity: .8; }
    footer a { color: var(--accent); }
  `]
})
export class PublicMasjidComponent implements OnInit {
  private readonly api = inject(MasjidApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly brand = BRAND;
  readonly embed = this.route.snapshot.queryParamMap.get('embed') === '1';
  readonly rows = SALAH;
  readonly data = signal<PublicMasjid | null>(null);
  readonly error = signal('');
  readonly showIqama = computed(() => !!this.data()?.masjid.widget.showIqama && Object.keys(this.data()?.iqama ?? {}).length > 0);
  readonly dateLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    const [y, m, day] = d.date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  });
  readonly jumuahLabel = computed(() => (this.data()?.masjid.jumuah ?? []).map(t => this.clock(t)).join(' · '));

  ngOnInit(): void {
    if (!this.browser) return;
    this.api.publicMasjid(this.route.snapshot.paramMap.get('slug') ?? '').subscribe({
      next: d => {
        this.data.set(d);
        if (typeof document !== 'undefined' && !this.embed) document.title = `${d.masjid.name} prayer times · ${BRAND.name}`;
      },
      error: err => this.error.set(errorMessage(err, 'This masjid page could not be loaded.'))
    });
  }

  /** "13:05" or "13:05:00" in the viewer's 12 or 24 hour style. */
  clock(value: string): string {
    const [h, m] = value.split(':').map(Number);
    return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  }
}
