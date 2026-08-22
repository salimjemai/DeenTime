import { Component, HostListener, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PublishEmbedCode, PublishService, TvDisplayConfigUpdate, resolvePublishEmbedCode } from '../../../services/publish';
import { AuthService } from '../../../services/auth';
import { PublishArtifact, PdfSize, PdfOrientation, TvDisplayConfig } from '../../../models';
import { OrganizationReadiness } from '../../../models';
import { OrgsService } from '../../../services/orgs';
import { apiErrorMessage } from '../../../services/api-error';
import { concatMap, finalize, from, toArray } from 'rxjs';

type PreviewMode = 'tv' | 'combined' | 'daily' | 'jumuah' | 'compact';
type WidgetPreviewMode = Exclude<PreviewMode, 'tv'>;

@Component({
  selector: 'app-publish',
  standalone: true,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatSelectModule, MatInputModule,
    MatCheckboxModule, MatTableModule, MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './publish.html',
  styleUrl: './publish.scss'
})
export class PublishComponent implements OnInit {
  private svc   = inject(PublishService);
  private auth  = inject(AuthService);
  private snack = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);
  private orgs = inject(OrgsService);

  orgId      = this.auth.getOrgId() ?? '';
  readonly publicAppOrigin = window.location.origin;
  generating = signal(false);
  loading    = signal(false);
  artifacts  = signal<PublishArtifact[]>([]);
  embedCode  = signal<PublishEmbedCode | null>(null);
  tvLoading  = signal(true);
  savingTv   = signal(false);
  generatingKey = signal('');
  generatingYear = signal(false);
  previewMode = signal<PreviewMode>('tv');
  previewSources = signal<Record<PreviewMode, SafeResourceUrl> | null>(null);
  widgetPreviewHeights = signal<Record<WidgetPreviewMode, number>>({
    combined: 900,
    daily: 720,
    jumuah: 560,
    compact: 800
  });
  readiness = signal<OrganizationReadiness | null>(null);
  readinessError = signal('');

  showSeconds = true;
  showHijri = true;
  accentColor = '#00AEEF';
  clockFontScale = 160;
  autoRefreshSeconds = 30;

  genYear        = new Date().getFullYear();
  genMonth       = new Date().getMonth() + 1;
  genSize: PdfSize        = 'Letter';
  genOrientation: PdfOrientation = 'Portrait';

  sizes: PdfSize[]               = ['Letter','Tabloid'];
  orientations: PdfOrientation[] = ['Portrait','Landscape'];
  months = Array.from({length:12},(_,i)=>({ value: i+1, label: new Date(0,i).toLocaleString('default',{month:'long'}) }));
  columns = ['period','size','orientation','download'];

  ngOnInit() {
    this.loadArtifacts();
    this.orgs.readiness(this.orgId).subscribe({
      next: value => this.readiness.set(value),
      error: error => this.readinessError.set(apiErrorMessage(error, 'Could not load publishing readiness.'))
    });
    this.svc.getEmbedCode(this.orgId, this.publicAppOrigin).subscribe({
      next: response => {
        const code = resolvePublishEmbedCode(response, this.publicAppOrigin);
        this.embedCode.set(code);
        this.setPreviewSources(code);
      }
    });
    this.svc.getTvConfig(this.orgId).subscribe({
      next: cfg => { this.setTvFields(cfg); this.tvLoading.set(false); },
      error: () => this.tvLoading.set(false)
    });
  }

  loadArtifacts() {
    this.loading.set(true);
    this.svc.listArtifacts(this.orgId, this.genYear).subscribe({
      next: a => { this.artifacts.set(a); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  generate() {
    this.generating.set(true);
    this.svc.generatePdf({ orgId: this.orgId, year: this.genYear, month: this.genMonth, size: this.genSize, orientation: this.genOrientation }).subscribe({
      next: () => { this.generating.set(false); this.loadArtifacts(); this.snack.open('PDF generated!', '', { duration: 3000 }); },
      error: () => { this.generating.set(false); this.snack.open('Generation failed', 'Dismiss', { duration: 3000 }); }
    });
  }

  artifactFor(month: number, size: PdfSize) {
    return this.artifacts().find(artifact => artifact.month === month && artifact.size === size);
  }

  generateArchive(month: number, size: PdfSize) {
    const key = `${month}-${size}`;
    this.generatingKey.set(key);
    this.svc.generatePdf({ orgId: this.orgId, year: this.genYear, month, size, orientation: 'Portrait' }).pipe(
      finalize(() => this.generatingKey.set(''))
    ).subscribe({
      next: () => { this.loadArtifacts(); this.snack.open('Schedule generated', '', { duration: 2200 }); },
      error: () => this.snack.open('Schedule generation failed', 'Dismiss', { duration: 3000 })
    });
  }

  generateRamadan(size: PdfSize) {
    const key = `0-${size}`;
    this.generatingKey.set(key);
    this.svc.generateRamadanPdf({ orgId: this.orgId, year: this.genYear, size, orientation: 'Portrait' }).pipe(
      finalize(() => this.generatingKey.set(''))
    ).subscribe({
      next: () => { this.loadArtifacts(); this.snack.open('Ramadan schedule generated', '', { duration: 2500 }); },
      error: () => this.snack.open('Ramadan generation failed', 'Dismiss', { duration: 3000 })
    });
  }

  generateYearSet() {
    const missing = this.months.flatMap(month => this.sizes
      .filter(size => !this.artifactFor(month.value, size))
      .map(size => ({ month: month.value, size })));
    if (missing.length === 0) {
      this.snack.open('The complete yearly set is already available.', '', { duration: 2500 });
      return;
    }

    this.generatingYear.set(true);
    from(missing).pipe(
      concatMap(item => this.svc.generatePdf({
        orgId: this.orgId, year: this.genYear, month: item.month, size: item.size, orientation: 'Portrait'
      })),
      toArray(),
      finalize(() => this.generatingYear.set(false))
    ).subscribe({
      next: generated => { this.loadArtifacts(); this.snack.open(`${generated.length} schedules generated`, '', { duration: 3000 }); },
      error: () => { this.loadArtifacts(); this.snack.open('Year generation stopped after an error', 'Dismiss', { duration: 3500 }); }
    });
  }

  periodLabel(artifact: PublishArtifact) {
    return artifact.month === 0 ? `Ramadan ${artifact.year}` : `${this.months[artifact.month - 1]?.label ?? artifact.month} ${artifact.year}`;
  }

  setTvFields(config: TvDisplayConfig) {
    this.showSeconds = config.showSeconds;
    this.showHijri = config.showHijri;
    this.accentColor = config.accentColor || '#00AEEF';
    this.clockFontScale = config.clockFontScale ?? 160;
    this.autoRefreshSeconds = config.autoRefreshSeconds || 30;
  }

  saveTvConfig() {
    this.savingTv.set(true);
    const config: TvDisplayConfigUpdate = {
      showSeconds: this.showSeconds,
      showHijri: this.showHijri, accentColor: this.accentColor,
      clockFontScale: Math.min(200, Math.max(80, Number(this.clockFontScale) || 160)),
      autoRefreshSeconds: this.autoRefreshSeconds
    };
    this.svc.updateTvConfig(this.orgId, config).subscribe({
      next: saved => {
        this.setTvFields(saved);
        const code = this.embedCode();
        if (code) this.setPreviewSources(code, true);
        this.savingTv.set(false);
        this.snack.open('TV display settings saved', '', { duration: 2500 });
      },
      error: () => { this.savingTv.set(false); this.snack.open('Could not save TV settings', 'Dismiss', { duration: 3000 }); }
    });
  }

  previewUrl() { return this.previewSources()?.[this.previewMode()] ?? null; }

  previewFrameHeight(): number | null {
    const mode = this.previewMode();
    return mode === 'tv' ? null : this.widgetPreviewHeights()[mode];
  }

  @HostListener('window:message', ['$event'])
  onWidgetResize(event: MessageEvent) {
    if (event.origin !== this.publicAppOrigin || event.data?.type !== 'iqamatime:widget-resize') return;
    const frame = document.querySelector<HTMLIFrameElement>('.preview-frame-shell iframe');
    if (!frame || event.source !== frame.contentWindow) return;

    const mode = this.previewMode();
    if (mode === 'tv') return;
    const expected = {
      combined: { variant: 'full', content: 'combined' },
      daily: { variant: 'full', content: 'daily' },
      jumuah: { variant: 'full', content: 'jumuah' },
      compact: { variant: 'compact', content: 'combined' }
    } satisfies Record<WidgetPreviewMode, { variant: string; content: string }>;
    if (event.data?.variant !== expected[mode].variant || event.data?.content !== expected[mode].content) return;

    const height = Math.round(Number(event.data?.height));
    if (!Number.isFinite(height)) return;
    this.widgetPreviewHeights.update(values => ({
      ...values,
      [mode]: Math.min(1400, Math.max(320, height))
    }));
  }

  previewHref() {
    const code = this.embedCode();
    if (!code) return '#';
    const urls: Record<PreviewMode, string> = {
      tv: code.tvUrl,
      combined: code.combinedWidgetUrl,
      daily: code.dailyWidgetUrl,
      jumuah: code.jumuahWidgetUrl,
      compact: code.compactWidgetUrl
    };
    return urls[this.previewMode()];
  }

  copy(value: string) {
    navigator.clipboard?.writeText(value).then(
      () => this.snack.open('Copied to clipboard', '', { duration: 1800 }),
      () => this.snack.open('Copy failed', 'Dismiss', { duration: 2500 })
    );
  }

  private setPreviewSources(code: PublishEmbedCode, cacheBust = false) {
    const source = (value: string) => {
      const url = new URL(value);
      if (cacheBust) url.searchParams.set('_preview', Date.now().toString());
      return this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
    };
    this.previewSources.set({
      tv: source(code.tvUrl),
      combined: source(code.combinedWidgetUrl),
      daily: source(code.dailyWidgetUrl),
      jumuah: source(code.jumuahWidgetUrl),
      compact: source(code.compactWidgetUrl)
    });
  }
}
