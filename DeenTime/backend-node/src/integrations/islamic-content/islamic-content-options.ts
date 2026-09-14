import { AppConfig } from '../../config/configuration.js';
import { ensureTrailingSlash } from './provider-http.js';

export interface IslamicContentOptionValues {
  quranBaseUrl: string;
  alAdhanBaseUrl: string;
  hadithBaseUrl: string;
  hadithApiKey: string;
  quranCacheDays: number;
  qiblaCacheDays: number;
}

/**
 * IslamicContentOptions bound from the "IslamicContent" configuration section.
 * Program.cs validated on start-up that the Qur'an and AlAdhan base URLs point at
 * the primary documented servers; the same validation runs in the constructor.
 */
export class IslamicContentOptions implements IslamicContentOptionValues {
  static readonly sectionName = 'IslamicContent';
  static readonly requiredQuranBaseUrl = 'https://api.alquran.cloud/v1/';
  static readonly requiredAlAdhanBaseUrl = 'https://api.aladhan.com/v1/';
  static readonly defaultHadithBaseUrl = 'https://hadithapi.com/api/';

  readonly quranBaseUrl: string;
  readonly alAdhanBaseUrl: string;
  readonly hadithBaseUrl: string;
  readonly hadithApiKey: string;
  readonly quranCacheDays: number;
  readonly qiblaCacheDays: number;

  constructor(values: Partial<IslamicContentOptionValues> = {}) {
    this.quranBaseUrl = values.quranBaseUrl ?? IslamicContentOptions.requiredQuranBaseUrl;
    this.alAdhanBaseUrl = values.alAdhanBaseUrl ?? IslamicContentOptions.requiredAlAdhanBaseUrl;
    this.hadithBaseUrl = values.hadithBaseUrl?.trim() ? values.hadithBaseUrl : IslamicContentOptions.defaultHadithBaseUrl;
    this.hadithApiKey = values.hadithApiKey ?? '';
    this.quranCacheDays = values.quranCacheDays ?? 30;
    this.qiblaCacheDays = values.qiblaCacheDays ?? 30;

    if (!sameServer(this.quranBaseUrl, IslamicContentOptions.requiredQuranBaseUrl)) {
      throw new Error(`IslamicContent:QuranBaseUrl must use the primary server ${IslamicContentOptions.requiredQuranBaseUrl}`);
    }
    if (!sameServer(this.alAdhanBaseUrl, IslamicContentOptions.requiredAlAdhanBaseUrl)) {
      throw new Error(`IslamicContent:AlAdhanBaseUrl must use the primary server ${IslamicContentOptions.requiredAlAdhanBaseUrl}`);
    }
  }

  static fromConfig(config: AppConfig): IslamicContentOptions {
    const section = IslamicContentOptions.sectionName;
    return new IslamicContentOptions({
      quranBaseUrl: config.get(`${section}:QuranBaseUrl`),
      alAdhanBaseUrl: config.get(`${section}:AlAdhanBaseUrl`),
      hadithBaseUrl: config.get(`${section}:HadithBaseUrl`),
      hadithApiKey: config.get(`${section}:HadithApiKey`),
      quranCacheDays: config.getInt(`${section}:QuranCacheDays`, 30),
      qiblaCacheDays: config.getInt(`${section}:QiblaCacheDays`, 30),
    });
  }

  /** True when a server-side Hadith API key is present (never exposed to clients). */
  get isHadithConfigured(): boolean {
    return this.hadithApiKey.trim().length > 0;
  }
}

function sameServer(configured: string, required: string): boolean {
  return ensureTrailingSlash(configured).toLowerCase() === required.toLowerCase();
}
