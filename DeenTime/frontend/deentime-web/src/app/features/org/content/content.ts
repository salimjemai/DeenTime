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
import { OrgsService } from '../../../services/orgs';
import { environment } from '../../../../environments/environment';
import {
  ApiClientAccess,
  HadithBook,
  HadithRecord,
  IslamicContentSummary,
  IslamicContentSyncState,
  QuranAyah,
  QuranEdition,
  QiblaDirectionResponse
} from '../../../models';
import { QiblaCompassCardComponent } from './qibla-compass-card';

interface VersePreview {
  number?: number;
  reference: string;
  arabic?: string;
  translation?: string;
  translator?: string;
  audioUrl?: string;
  reciter?: string;
  audioEdition?: string;
  juz?: number;
  page?: number;
}

type HadithLanguage = 'en' | 'ar' | 'ur';
type HadithFace = 'front' | 'back';

const ARABIC_HADITH_BOOK_NAMES: Readonly<Record<string, string>> = {
  'sahih-bukhari': 'صحيح البخاري',
  'sahih-muslim': 'صحيح مسلم',
  'al-tirmidhi': 'جامع الترمذي',
  'abu-dawood': 'سنن أبي داود',
  'ibn-e-majah': 'سنن ابن ماجه',
  'sunan-nasai': 'سنن النسائي',
  mishkat: 'مشكاة المصابيح',
  'musnad-ahmad': 'مسند أحمد',
  'al-silsila-sahiha': 'السلسلة الصحيحة'
};

const URDU_HADITH_BOOK_NAMES: Readonly<Record<string, string>> = {
  'sahih-bukhari': 'صحیح بخاری',
  'sahih-muslim': 'صحیح مسلم',
  'al-tirmidhi': 'جامع ترمذی',
  'abu-dawood': 'سنن ابو داؤد',
  'ibn-e-majah': 'سنن ابن ماجہ',
  'sunan-nasai': 'سنن نسائی',
  mishkat: 'مشکوٰۃ المصابیح',
  'musnad-ahmad': 'مسند احمد',
  'al-silsila-sahiha': 'سلسلہ احادیث صحیحہ'
};

const ARABIC_HADITH_GRADES: Readonly<Record<string, string>> = {
  sahih: 'صحيح',
  authentic: 'صحيح',
  hasan: 'حسن',
  good: 'حسن',
  daeef: 'ضعيف',
  daif: 'ضعيف',
  weak: 'ضعيف',
  mawdu: 'موضوع',
  fabricated: 'موضوع',
  marfu: 'مرفوع',
  mawquf: 'موقوف',
  mauquf: 'موقوف',
  maqtu: 'مقطوع'
};

const URDU_HADITH_GRADES: Readonly<Record<string, string>> = {
  sahih: 'صحیح',
  authentic: 'صحیح',
  hasan: 'حسن',
  good: 'حسن',
  daeef: 'ضعیف',
  daif: 'ضعیف',
  weak: 'ضعیف',
  mawdu: 'موضوع',
  fabricated: 'موضوع',
  marfu: 'مرفوع',
  mawquf: 'موقوف',
  mauquf: 'موقوف',
  maqtu: 'مقطوع'
};

@Component({
  selector: 'app-content',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    QiblaCompassCardComponent
  ],
  templateUrl: './content.html',
  styleUrl: './content.scss'
})
export class ContentComponent implements OnInit {
  private content = inject(IslamicContentService);
  private auth = inject(AuthService);
  private orgs = inject(OrgsService);
  private snack = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);
  private completionMarkers = new Map<string, string>();
  private reciterRequest = 0;

  summary = signal<IslamicContentSummary | null>(null);
  editions = signal<QuranEdition[]>([]);
  books = signal<HadithBook[]>([]);
  verse = signal<VersePreview | null>(null);
  hadiths = signal<HadithRecord[]>([]);
  hadithTotal = signal(0);
  loadingSummary = signal(true);
  verseLoading = signal(true);
  reciterLoading = signal(false);
  hadithLoading = signal(false);
  flippedHadithIds = signal<ReadonlySet<number>>(new Set<number>());
  syncing = signal<'' | 'quran' | 'hadith'>('');
  apiClients = signal<ApiClientAccess[]>([]);
  apiClientsLoading = signal(true);
  apiClientBusy = signal('');
  issuedClient = signal<{ name: string; key: string } | null>(null);
  qibla = signal<QiblaDirectionResponse | null>(null);
  qiblaLoading = signal(true);
  qiblaError = signal('');
  qiblaCompassUrl = signal('');
  qiblaLocation = signal('Your masjid');
  qiblaCoordinates = signal<{ latitude: number; longitude: number } | null>(null);

  selectedBook = '';
  selectedReciter = 'ar.alafasy';
  hadithSearch = '';
  language: HadithLanguage = 'en';
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
  reciters = computed(() => {
    const priority = new Map([
      'ar.alafasy',
      'ar.abdurrahmaansudais',
      'ar.abdulsamad',
      'ar.husary',
      'ar.minshawi',
      'ar.mahermuaiqly',
      'ar.shaatree'
    ].map((identifier, index) => [identifier, index]));
    const ordered = this.editions()
      .filter(edition => edition.format === 'audio' && edition.language === 'ar')
      .sort((left, right) => {
        const leftPriority = priority.get(left.identifier) ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = priority.get(right.identifier) ?? Number.MAX_SAFE_INTEGER;
        return leftPriority - rightPriority || left.englishName.localeCompare(right.englishName);
      });
    const seenNames = new Set<string>();
    return ordered.filter(edition => {
      const name = edition.englishName.trim().toLocaleLowerCase();
      if (seenNames.has(name)) return false;
      seenNames.add(name);
      return true;
    });
  });

  apiExamples = computed(() => {
    const coordinates = this.qiblaCoordinates() ?? { latitude: 30.5052, longitude: -97.8203 };
    const qiblaPath = `/public/content/qibla/${coordinates.latitude}/${coordinates.longitude}`;
    return [
    {
      label: 'Random ayah · Arabic + English + audio',
      path: '/public/content/quran/ayah/random/editions/quran-uthmani,en.sahih,ar.alafasy'
    },
    {
      label: 'Reciter sample for one ayah',
      path: '/public/content/quran/showcase/ayah/1/recitation/ar.alafasy'
    },
    { label: 'Complete Qur’an edition', path: '/public/content/quran/quran/en.sahih' },
    { label: 'Search the Qur’an', path: '/public/content/quran/search/mercy/all/en?limit=20' },
    { label: 'Qibla bearing · This masjid', path: qiblaPath },
    { label: 'Qibla compass PNG · This masjid', path: `${qiblaPath}/compass` },
    { label: 'Hadith book catalogue', path: '/public/content/hadith/books' },
    { label: 'Search Hadith in English', path: '/public/content/hadith/hadiths?language=en&search=intention&pageSize=20' },
    { label: 'Random Hadith', path: '/public/content/hadith/hadiths/random?language=en' }
    ];
  });

  ngOnInit() {
    this.loadSummary();
    this.loadEditions();
    this.loadBooks();
    this.loadRandomAyah();
    this.searchHadith();
    this.loadApiClients();
    this.loadQibla();

    this.destroyRef.onDestroy(() => this.releaseQiblaImage());

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
      next: response => {
        this.editions.set(response.data);
        const available = this.reciters();
        if (available.length && !available.some(reciter => reciter.identifier === this.selectedReciter)) {
          this.selectedReciter = available[0].identifier;
        }
      },
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
    this.reciterRequest += 1;
    this.verseLoading.set(true);
    this.reciterLoading.set(false);
    this.content.randomAyah().subscribe({
      next: response => {
        const items = Array.isArray(response.data) ? response.data : [response.data];
        const preview = this.toVersePreview(items);
        this.verse.set(preview);
        this.verseLoading.set(false);
        if (preview.audioEdition !== this.selectedReciter) this.loadReciterSample(false);
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
        this.flippedHadithIds.set(new Set<number>());
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
        this.flippedHadithIds.set(new Set<number>());
        this.hadithLoading.set(false);
      },
      error: error => {
        this.hadithLoading.set(false);
        this.notifyError(error, 'No Hadith is available for those filters yet.');
      }
    });
  }

  changeReciter() {
    this.loadReciterSample(true);
  }

  changeHadithLanguage(language: HadithLanguage) {
    if (this.language === language) return;
    this.language = language;
    this.searchHadith();
  }

  hadithFaceLanguage(face: HadithFace): HadithLanguage {
    if (face === 'front') return this.language;
    return this.language === 'ar' ? 'en' : 'ar';
  }

  hadithFaceLanguageName(face: HadithFace) {
    const language = this.hadithFaceLanguage(face);
    return language === 'ar' ? 'Arabic' : language === 'ur' ? 'Urdu' : 'English';
  }

  hadithFaceLanguageNative(face: HadithFace) {
    const language = this.hadithFaceLanguage(face);
    return language === 'ar' ? 'العربية' : language === 'ur' ? 'اردو' : 'English';
  }

  hadithFaceText(record: HadithRecord, face: HadithFace) {
    switch (this.hadithFaceLanguage(face)) {
      case 'ar': return record.hadithArabic;
      case 'ur': return record.hadithUrdu;
      default: return record.hadithEnglish;
    }
  }

  hadithFaceHeading(record: HadithRecord, face: HadithFace) {
    switch (this.hadithFaceLanguage(face)) {
      case 'ar': return record.headingArabic;
      case 'ur': return record.headingUrdu;
      default: return record.headingEnglish;
    }
  }

  hadithFaceNarrator(record: HadithRecord, face: HadithFace) {
    switch (this.hadithFaceLanguage(face)) {
      case 'ur': return record.urduNarrator;
      case 'en': return record.englishNarrator;
      default: return undefined;
    }
  }

  hadithFaceIsRtl(face: HadithFace) {
    return this.hadithFaceLanguage(face) !== 'en';
  }

  hadithBookOptionName(book: HadithBook) {
    return this.hadithBookName(book.slug, this.language, book.name);
  }

  hadithEveryBookLabel() {
    return this.language === 'ar' ? 'جميع الكتب' : this.language === 'ur' ? 'تمام کتب' : 'Every book';
  }

  hadithFaceBookName(record: HadithRecord, face: HadithFace) {
    return this.hadithBookName(record.bookSlug, this.hadithFaceLanguage(face));
  }

  hadithFaceNumber(record: HadithRecord, face: HadithFace) {
    const language = this.hadithFaceLanguage(face);
    if (language === 'ar') {
      return `الحديث رقم ${this.toArabicNumerals(record.hadithNumber)}${record.chapterNumber ? ` · الباب ${this.toArabicNumerals(record.chapterNumber)}` : ''}`;
    }
    if (language === 'ur') {
      return `حدیث نمبر ${this.toUrduNumerals(record.hadithNumber)}${record.chapterNumber ? ` · باب ${this.toUrduNumerals(record.chapterNumber)}` : ''}`;
    }
    return `No. ${record.hadithNumber}${record.chapterNumber ? ` · Chapter ${record.chapterNumber}` : ''}`;
  }

  hadithFaceGrade(status: string, face: HadithFace) {
    const language = this.hadithFaceLanguage(face);
    if (language === 'en') return status;
    const key = this.hadithGradeKey(status);
    return language === 'ar'
      ? ARABIC_HADITH_GRADES[key] ?? 'غير مصنّف'
      : URDU_HADITH_GRADES[key] ?? 'غیر درجہ بند';
  }

  hadithFaceFlipLabel(face: HadithFace) {
    return this.hadithFaceLanguageNative(face === 'front' ? 'back' : 'front');
  }

  hadithFaceScrollLabel(face: HadithFace) {
    switch (this.hadithFaceLanguage(face)) {
      case 'ar': return 'النص العربي الكامل للحديث. مرّر للقراءة.';
      case 'ur': return 'حدیث کا مکمل اردو متن۔ مکمل پڑھنے کے لیے اسکرول کریں۔';
      default: return 'English Hadith text. Scroll to read the complete Hadith.';
    }
  }

  hadithFaceUnavailable(face: HadithFace) {
    switch (this.hadithFaceLanguage(face)) {
      case 'ar': return 'النص العربي غير متاح لهذا الحديث.';
      case 'ur': return 'اس حدیث کا اردو ترجمہ دستیاب نہیں ہے۔';
      default: return 'This translation is not available for this record.';
    }
  }

  hadithFaceSourceLabel(record: HadithRecord, face: HadithFace) {
    switch (this.hadithFaceLanguage(face)) {
      case 'ar': return `معرّف المصدر ${this.toArabicNumerals(record.id)}`;
      case 'ur': return `ماخذ شناخت ${this.toUrduNumerals(record.id)}`;
      default: return `Source ID ${record.id}`;
    }
  }

  hadithFlipInstruction() {
    return `Select a card to flip ${this.hadithFaceLanguageName('front')} ↔ ${this.hadithFaceLanguageName('back')}`;
  }

  canFlipHadith(record: HadithRecord) {
    return !!this.hadithFaceText(record, 'front')?.trim() && !!this.hadithFaceText(record, 'back')?.trim();
  }

  isHadithFlipped(id: number) {
    return this.flippedHadithIds().has(id);
  }

  flipHadith(record: HadithRecord) {
    if (!this.canFlipHadith(record)) return;
    this.flippedHadithIds.update(ids => {
      const next = new Set(ids);
      if (next.has(record.id)) next.delete(record.id);
      else next.add(record.id);
      return next;
    });
  }

  hadithCardLabel(record: HadithRecord) {
    const visibleFace: HadithFace = this.isHadithFlipped(record.id) ? 'back' : 'front';
    const language = this.hadithFaceLanguage(visibleFace);
    if (!this.canFlipHadith(record)) return this.hadithFaceNumber(record, visibleFace);
    const targetFace: HadithFace = visibleFace === 'front' ? 'back' : 'front';
    if (language === 'ar') {
      return `الحديث رقم ${this.toArabicNumerals(record.hadithNumber)}: ${this.hadithFaceLanguageNative(targetFace)}`;
    }
    if (language === 'ur') {
      return `حدیث نمبر ${this.toUrduNumerals(record.hadithNumber)}: ${this.hadithFaceLanguageNative(targetFace)}`;
    }
    return `Hadith ${record.hadithNumber}: show ${this.hadithFaceLanguageName(targetFace)}`;
  }

  toArabicNumerals(value: string | number | undefined) {
    if (value === undefined) return '';
    return String(value).replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
  }

  toUrduNumerals(value: string | number | undefined) {
    if (value === undefined) return '';
    return String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  }

  private hadithBookName(bookSlug: string, language: HadithLanguage, englishFallback?: string) {
    const slug = bookSlug.trim().toLowerCase();
    if (language === 'ar') return ARABIC_HADITH_BOOK_NAMES[slug] ?? 'كتاب الحديث';
    if (language === 'ur') return URDU_HADITH_BOOK_NAMES[slug] ?? 'کتاب حدیث';
    return englishFallback
      ?? this.books().find(book => book.slug.trim().toLowerCase() === slug)?.name
      ?? slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  private hadithGradeKey(status: string) {
    return status
      .trim()
      .toLowerCase()
      .replace(/[`'’ʼ\-\s]/g, '');
  }

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

  loadQibla() {
    if (!this.organizationId) {
      this.qiblaLoading.set(false);
      this.qiblaError.set('Set up an organization before loading its Qibla direction.');
      return;
    }

    this.qiblaLoading.set(true);
    this.qiblaError.set('');
    this.orgs.get(this.organizationId).subscribe({
      next: organization => {
        const criteria = organization.criteria;
        if (!criteria || !Number.isFinite(criteria.latitude) || !Number.isFinite(criteria.longitude)) {
          this.qiblaLoading.set(false);
          this.qiblaError.set('Save the masjid location on the Profile tab to calculate Qibla.');
          return;
        }

        const coordinates = { latitude: criteria.latitude, longitude: criteria.longitude };
        this.qiblaCoordinates.set(coordinates);
        this.qiblaLocation.set([organization.name, organization.city, organization.state].filter(Boolean).join(' · '));
        this.content.qiblaDirection(coordinates.latitude, coordinates.longitude).subscribe({
          next: response => {
            this.qibla.set(response);
            this.qiblaLoading.set(false);
          },
          error: error => {
            this.qiblaLoading.set(false);
            this.qiblaError.set((error as HttpErrorResponse)?.error?.error ?? 'Could not load the Qibla direction.');
          }
        });
        this.content.qiblaCompass(coordinates.latitude, coordinates.longitude).subscribe({
          next: blob => {
            this.releaseQiblaImage();
            this.qiblaCompassUrl.set(URL.createObjectURL(blob));
          },
          error: () => this.qiblaCompassUrl.set('')
        });
      },
      error: () => {
        this.qiblaLoading.set(false);
        this.qiblaError.set('Could not read the masjid location from its profile.');
      }
    });
  }

  qiblaApiPath() {
    const coordinates = this.qiblaCoordinates();
    return coordinates ? `/public/content/qibla/${coordinates.latitude}/${coordinates.longitude}` : '/public/content/qibla/{latitude}/{longitude}';
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

  private loadReciterSample(notifyOnError: boolean) {
    const currentVerse = this.verse();
    if (!currentVerse?.number || !this.selectedReciter) return;

    const requestId = ++this.reciterRequest;
    const verseNumber = currentVerse.number;
    const edition = this.selectedReciter;
    this.reciterLoading.set(true);
    this.content.ayahRecitation(verseNumber, edition).subscribe({
      next: response => {
        if (requestId !== this.reciterRequest || this.verse()?.number !== verseNumber || this.selectedReciter !== edition) return;
        this.verse.update(verse => verse ? {
          ...verse,
          audioUrl: response.data.audio,
          reciter: response.data.edition.englishName,
          audioEdition: response.data.edition.identifier
        } : verse);
        this.reciterLoading.set(false);
      },
      error: error => {
        if (requestId !== this.reciterRequest) return;
        this.reciterLoading.set(false);
        this.selectedReciter = this.verse()?.audioEdition ?? this.selectedReciter;
        if (notifyOnError) this.notifyError(error, 'Could not load that reciter sample.');
      }
    });
  }

  private toVersePreview(items: QuranAyah[]): VersePreview {
    const arabic = items.find(item => item.edition?.format === 'text' && item.edition?.language === 'ar');
    const translation = items.find(item => item.edition?.format === 'text' && item.edition?.language === 'en');
    const audio = items.find(item => item.edition?.format === 'audio');
    const anchor = arabic ?? translation ?? audio;
    return {
      number: anchor?.number,
      reference: anchor ? `${anchor.surah.englishName} · ${anchor.surah.number}:${anchor.numberInSurah}` : 'Random ayah',
      arabic: arabic?.text,
      translation: translation?.text,
      translator: translation?.edition.englishName,
      audioUrl: audio?.audio,
      reciter: audio?.edition.englishName,
      audioEdition: audio?.edition.identifier,
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

  private releaseQiblaImage() {
    const url = this.qiblaCompassUrl();
    if (url) URL.revokeObjectURL(url);
    this.qiblaCompassUrl.set('');
  }
}
