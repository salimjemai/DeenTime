import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type AppIconName =
  | 'brand'
  | 'timings'
  | 'iqama'
  | 'design'
  | 'hijri'
  | 'publish'
  | 'content'
  | 'profile'
  | 'help'
  | 'logout'
  | 'menu'
  | 'collapse'
  | 'expand';

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      @switch (name) {
        @case ('brand') {
          <path d="M4.25 20V10.5L7 8.1V5.9L8.5 4.4 10 5.9v1.08L12 5.25l2 1.73V5.9l1.5-1.5L17 5.9v2.2l2.75 2.4V20" />
          <path d="M2.75 20h18.5M8.25 20v-5.1a3.75 3.75 0 0 1 7.5 0V20M4.25 11h3M16.75 11h3" />
        }
        @case ('timings') {
          <circle cx="11" cy="12" r="7.25" />
          <path d="M11 8v4.35l3 1.65M18.25 5.25h3M19.75 3.75v3" />
        }
        @case ('iqama') {
          <path d="M4 20v-8.6L7 9V6.2l1.45-1.45L9.9 6.2v1.2L12 5.6l2.1 1.8V6.2l1.45-1.45L17 6.2V9l3 2.4V20" />
          <path d="M2.75 20h18.5M8.4 20v-4.55a3.6 3.6 0 0 1 7.2 0V20M4 12h3.1M16.9 12H20" />
          <circle cx="12" cy="15.2" r="1.05" />
        }
        @case ('design') {
          <path d="M12 3.25a8.75 8.75 0 0 0 0 17.5h1.15a1.7 1.7 0 0 0 1.18-2.92 1.72 1.72 0 0 1 1.19-2.96h1.38A3.85 3.85 0 0 0 20.75 11 7.8 7.8 0 0 0 12 3.25Z" />
          <circle cx="7.55" cy="11.3" r=".85" /><circle cx="9.4" cy="7.35" r=".85" /><circle cx="13.55" cy="6.65" r=".85" /><circle cx="16.65" cy="9.4" r=".85" />
        }
        @case ('hijri') {
          <rect x="3.25" y="5.25" width="17.5" height="15.25" rx="2.5" />
          <path d="M7.25 3.5v3.25M16.75 3.5v3.25M3.25 9.25h17.5" />
          <path d="M14.65 12.15a3.15 3.15 0 1 0 2.95 4.45 3.6 3.6 0 1 1-2.95-4.45Z" />
        }
        @case ('publish') {
          <rect x="3.25" y="4.25" width="13.5" height="15.5" rx="2.25" />
          <path d="M7 8h6M7 11.25h4.25M8.5 16.5h8.75a3.5 3.5 0 0 0 3.5-3.5V9.25" />
          <path d="m17.25 6.5 3.5 2.75-3.5 2.75" />
        }
        @case ('content') {
          <path d="M3.25 5.25c3.2-.75 6.25.1 8.75 2.2v12.3c-2.5-2.1-5.55-2.95-8.75-2.2V5.25ZM20.75 5.25c-3.2-.75-6.25.1-8.75 2.2v12.3c2.5-2.1 5.55-2.95 8.75-2.2V5.25Z" />
          <path d="m17.25 2.75.55 1.18 1.2.57-1.2.57-.55 1.18-.55-1.18-1.2-.57 1.2-.57.55-1.18Z" />
        }
        @case ('profile') {
          <circle cx="8" cy="7.25" r="2.75" />
          <path d="M3.5 18.75v-1.4a4.5 4.5 0 0 1 9 0v1.4M15 7h5.5M17.75 4.25v5.5M15 14h5.5M18.75 11.25v5.5" />
        }
        @case ('help') {
          <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="4" />
          <path d="M9.25 9.2a2.85 2.85 0 1 1 4.3 2.45c-1.05.62-1.55 1.08-1.55 2.1M12 17.15h.01" />
        }
        @case ('logout') {
          <path d="M10.25 4.25H5.5a2.25 2.25 0 0 0-2.25 2.25v11A2.25 2.25 0 0 0 5.5 19.75h4.75M13.75 8l4 4-4 4M7.5 12h10.25" />
        }
        @case ('menu') {
          <path d="M4 6.75h16M4 12h16M4 17.25h16" />
        }
        @case ('collapse') {
          <path d="M19.5 4v16M15.5 7.5 11 12l4.5 4.5M4.5 7.5h6M4.5 12h5M4.5 16.5h6" />
        }
        @case ('expand') {
          <path d="M4.5 4v16M8.5 7.5 13 12l-4.5 4.5M13.5 7.5h6M14.5 12h5M13.5 16.5h6" />
        }
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-grid; width: 1.5rem; height: 1.5rem; place-items: center; }
    svg { display: block; width: 100%; height: 100%; overflow: visible; }
    path, rect, circle {
      vector-effect: non-scaling-stroke;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `]
})
export class AppIconComponent {
  @Input({ required: true }) name!: AppIconName;
}
