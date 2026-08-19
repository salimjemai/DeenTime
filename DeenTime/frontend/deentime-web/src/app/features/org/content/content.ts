import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IslamicContentService } from '../../../services/islamic-content';
import { AuthService } from '../../../services/auth';
import { environment } from '../../../../environments/environment';
import {
  ApiClientAccess,
  HadithBook,
  HadithRecord,
  IslamicContentSummary,
  IslamicContentSyncState,
  QuranAyah,
  QuranEdition
} from '../../../models';

interface VersePreview {
  reference: string;
  arabic?: string;
  translation?: string;
  translator?: string;
  audioUrl?: string;
  reciter?: string;
  juz?: number;
  page?: number;
}

@Component({
  selector: 'app-content',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule
  ],
  templateUrl: './content.html',
  styleUrl: './content.scss'
})
export class ContentComponent implements OnInit {
  private content = inject(IslamicContentService);
  private auth = inject(AuthService);
  private snack = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);
  private completionMarkers = new Map<string, string>();

  summary = signal<IslamicContentSummary | null>(null);
  editions = signal<QuranEdition[]>([]);
  books = signal<HadithBook[]>([]);
  verse = signal<VersePreview | null>(null);
  hadiths = signal<HadithRecord[]>([]);
  hadithTotal = signal(0);
  loadingSummary = signal(true);
  verseLoading = signal(true);
  hadithLoading = signal(false);
  syncing = signal<'' | 'quran' | 'hadith'>('');
  apiClients = signal<ApiClientAccess[]>([]);
  apiClientsLoading = signal(true);
  apiClientBusy = signal('');
  issuedClient = signal<{ name: string; key: string } | null>(null);

  selectedBook = '';
  hadithSearch = '';
  language: 'en' | 'ar' | 'ur' = 'en';
  apiClientName = '';
  apiClientRateLimit = 60;
  readonly organizationId = this.auth.getOrgId() ?? '';

  quranState = computed(() => this.summary()?.syncStates.find(state => state.provider === 'quran'));
  hadithState = computed(() => this.summary()?.syncStates.find(state => state.provider === 'hadith'));
  quranProgress = computed(() => this.progress(this.quranState()));
  hadithProgress = computed(() => this.progress(this.hadithState()));
  textPercent = computed(() => this.editionPercent(this.summary()?.quran.textEditionCount));
  audioPercent = computed(() => this.editionPercent(this.summary()?.quran.audioEditionCount));
  additionalLanguages = computed(() => Math.max(0, (this.summary()?.quran.languageCount ?? 0) - 12));

  apiExamples = [
    {
      label: 'Random ayah · Arabic + English + audio',
      path: '/public/content/quran/ayah/random/editions/quran-uthmani,en.sahih,ar.alafasy'
    },
    { label: 'Complete Qur’an edition', path: '/public/content/quran/quran/en.sahih' },
    { label: 'Search the Qur’an', path: '/public/content/quran/search/mercy/all/en?limit=20' },
    { label: 'Hadith book catalogue', path: '/public/content/hadith/books' },
    { label: 'Search Hadith in English', path: '/public/content/hadith/hadiths?language=en&search=intention&pageSize=20' },
    { label: 'Random Hadith', path: '/public/content/hadith/hadiths/random?language=en' }
  ];

  ngOnInit() {
    this.loadSummary();
    this.loadEditions();
    this.loadBooks();
    this.loadRandomAyah();
    this.searchHadith();
    this.loadApiClients();

    interval(5000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.syncing() || this.quranState()?.status === 'running' || this.hadithState()?.status === 'running') {
        this.loadSummary();
      }
    });
  }

  loadSummary() {
    this.content.summary().subscribe({
      next: summary => {
        this.summary.set(summary);
        this.loadingSummary.set(false);
        this.handleCompletedSync(summary.syncStates);
        if (!summary.syncStates.some(state => state.status === 'running' || state.status === 'queued')) {
          this.syncing.set('');
        }
      },
      error: error => {
        this.loadingSummary.set(false);
        this.notifyError(error, 'Could not load the content library summary.');
      }
    });
  }

  loadEditions() {
    this.content.quranEditions().subscribe({
      next: response => this.editions.set(response.data),
      error: () => this.editions.set([])
    });
  }

  loadBooks() {
    this.content.hadithBooks().subscribe({
      next: response => this.books.set(response.data),
      error: () => this.books.set([])
    });
  }

  syncQuran(scope: 'catalog' | 'text' | 'all') {
    this.syncing.set('quran');
    this.content.syncQuran(scope).subscribe({
      next: () => {
        this.snack.open(`Qur’an ${scope === 'all' ? 'text + audio' : scope} sync queued`, '', { duration: 2600 });
        window.setTimeout(() => this.loadSummary(), 450);
      },
      error: error => {
        this.syncing.set('');
        this.notifyError(error, 'Could not start the Qur’an sync.');
      }
    });
  }

  syncHadith() {
    this.syncing.set('hadith');
    this.content.syncHadith().subscribe({
      next: () => {
        this.snack.open('Full multilingual Hadith import queued', '', { duration: 2600 });
        window.setTimeout(() => this.loadSummary(), 450);
      },
      error: error => {
        this.syncing.set('');
        this.notifyError(error, 'Could not start the Hadith import.');
      }
    });
  }

  loadRandomAyah() {
    this.verseLoading.set(true);
    this.content.randomAyah().subscribe({
      next: response => {
        const items = Array.isArray(response.data) ? response.data : [response.data];
        this.verse.set(this.toVersePreview(items));
        this.verseLoading.set(false);
      },
      error: error => {
        this.verseLoading.set(false);
        this.notifyError(error, 'Could not load a Qur’an preview.');
      }
    });
  }

  searchHadith() {
    this.hadithLoading.set(true);
    this.content.searchHadiths({
      book: this.selectedBook || undefined,
      search: this.hadithSearch.trim() || undefined,
      language: this.language,
      page: 1,
      pageSize: 6
    }).subscribe({
      next: response => {
        this.hadiths.set(response.items);
        this.hadithTotal.set(response.total);
        this.hadithLoading.set(false);
      },
      error: () => {
        this.hadiths.set([]);
        this.hadithTotal.set(0);
        this.hadithLoading.set(false);
      }
    });
  }

  randomHadith() {
    this.hadithLoading.set(true);
    this.content.randomHadith({ book: this.selectedBook || undefined, language: this.language }).subscribe({
      next: response => {
        this.hadiths.set([response.data]);
        this.hadithTotal.set(1);
        this.hadithLoading.set(false);
      },
      error: error => {
        this.hadithLoading.set(false);
        this.notifyError(error, 'No Hadith is available for those filters yet.');
      }
    });
  }

  hadithText(record: HadithRecord) {
    return this.language === 'ar' ? record.hadithArabic : this.language === 'ur' ? record.hadithUrdu : record.hadithEnglish;
  }

  hadithHeading(record: HadithRecord) {
    return this.language === 'ar' ? record.headingArabic : this.language === 'ur' ? record.headingUrdu : record.headingEnglish;
  }

  hadithNarrator(record: HadithRecord) {
    return this.language === 'ur' ? record.urduNarrator : record.englishNarrator;
  }

  isRtl() { return this.language === 'ar' || this.language === 'ur'; }

  stateLabel(state?: IslamicContentSyncState) {
    if (!state) return 'Not synchronized';
    return state.status === 'complete' ? 'Ready' : state.status.charAt(0).toUpperCase() + state.status.slice(1);
  }

  formatNumber(value = 0) { return new Intl.NumberFormat().format(value); }

  formatStorage(characters = 0) {
    if (characters <= 0) return '0 MB';
    const megabytes = characters / 1_000_000;
    return megabytes >= 1000 ? `${(megabytes / 1000).toFixed(1)} GB` : `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  }

  apiUrl(path: string) {
    const apiOrigin = new URL(environment.apiUrl, window.location.origin).origin;
    return new URL(path, apiOrigin).toString();
  }

  copyApi(path: string) {
    const command = `curl --header "X-IqamaTime-Client-Key: YOUR_CLIENT_KEY" "${this.apiUrl(path)}"`;
    navigator.clipboard?.writeText(command).then(
      () => this.snack.open('Authenticated request example copied', '', { duration: 1700 }),
      () => this.snack.open('Could not copy the URL', 'Dismiss', { duration: 2500 })
    );
  }

  loadApiClients() {
    if (!this.organizationId) {
      this.apiClientsLoading.set(false);
      return;
    }
    this.content.apiClients(this.organizationId).subscribe({
      next: response => {
        this.apiClients.set(response.data);
        this.apiClientsLoading.set(false);
      },
      error: error => {
        this.apiClientsLoading.set(false);
        this.notifyError(error, 'Could not load API access keys.');
      }
    });
  }

  createApiClient() {
    const name = this.apiClientName.trim();
    if (!name || !this.organizationId) return;
    this.apiClientBusy.set('create');
    this.content.createApiClient(this.organizationId, name, this.apiClientRateLimit).subscribe({
      next: response => {
        this.issuedClient.set({ name: response.client.name, key: response.clientKey });
        this.apiClientName = '';
        this.apiClientBusy.set('');
        this.loadApiClients();
        this.snack.open('API key created — copy it now; it is shown only once', '', { duration: 4200 });
      },
      error: error => {
        this.apiClientBusy.set('');
        this.notifyError(error, 'Could not create the API key.');
      }
    });
  }

  rotateApiClient(client: ApiClientAccess) {
    if (!this.organizationId || !window.confirm(`Rotate the key for ${client.name}? The previous key will stop working immediately.`)) return;
    this.apiClientBusy.set(client.id);
    this.content.rotateApiClient(this.organizationId, client.id).subscribe({
      next: response => {
        this.issuedClient.set({ name: response.client.name, key: response.clientKey });
        this.apiClientBusy.set('');
        this.loadApiClients();
      },
      error: error => {
        this.apiClientBusy.set('');
        this.notifyError(error, 'Could not rotate the API key.');
      }
    });
  }

  revokeApiClient(client: ApiClientAccess) {
    if (!this.organizationId || !window.confirm(`Revoke ${client.name}? Its API requests will be rejected immediately.`)) return;
    this.apiClientBusy.set(client.id);
    this.content.revokeApiClient(this.organizationId, client.id).subscribe({
      next: () => {
        this.apiClientBusy.set('');
        this.loadApiClients();
        this.snack.open('API key revoked', '', { duration: 2200 });
      },
      error: error => {
        this.apiClientBusy.set('');
        this.notifyError(error, 'Could not revoke the API key.');
      }
    });
  }

  copyIssuedKey() {
    const key = this.issuedClient()?.key;
    if (!key) return;
    navigator.clipboard?.writeText(key).then(
      () => this.snack.open('Client key copied', '', { duration: 1800 }),
      () => this.snack.open('Could not copy the client key', 'Dismiss', { duration: 2500 })
    );
  }

  dismissIssuedKey() { this.issuedClient.set(null); }

  clientStatus(client: ApiClientAccess) { return client.revokedAtUtc ? 'Revoked' : 'Active'; }

  private toVersePreview(items: QuranAyah[]): VersePreview {
    const arabic = items.find(item => item.edition?.format === 'text' && item.edition?.language === 'ar');
    const translation = items.find(item => item.edition?.format === 'text' && item.edition?.language === 'en');
    const audio = items.find(item => item.edition?.format === 'audio');
    const anchor = arabic ?? translation ?? audio;
    return {
      reference: anchor ? `${anchor.surah.englishName} · ${anchor.surah.number}:${anchor.numberInSurah}` : 'Random ayah',
      arabic: arabic?.text,
      translation: translation?.text,
      translator: translation?.edition.englishName,
      audioUrl: audio?.audio,
      reciter: audio?.edition.englishName,
      juz: anchor?.juz,
      page: anchor?.page
    };
  }

  private progress(state?: IslamicContentSyncState) {
    if (!state?.totalItems) return 0;
    return Math.min(100, Math.round(state.processedItems / state.totalItems * 100));
  }

  private editionPercent(count = 0) {
    const total = this.summary()?.quran.editionCount ?? 0;
    return total ? count / total * 100 : 0;
  }

  private handleCompletedSync(states: IslamicContentSyncState[]) {
    for (const state of states) {
      if (!state.completedAtUtc || state.status !== 'complete') continue;
      if (this.completionMarkers.get(state.provider) === state.completedAtUtc) continue;
      this.completionMarkers.set(state.provider, state.completedAtUtc);
      if (state.provider === 'quran') this.loadEditions();
      if (state.provider === 'hadith') {
        this.loadBooks();
        this.searchHadith();
      }
    }
  }

  private notifyError(error: unknown, fallback: string) {
    const httpError = error as HttpErrorResponse;
    const message = httpError?.error?.error ?? httpError?.error?.detail ?? fallback;
    this.snack.open(message, 'Dismiss', { duration: 4200 });
  }
}
