import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  ApiClientAccess,
  HadithBook,
  HadithRecord,
  IslamicContentSummary,
  IslamicContentSyncState,
  IssuedApiClient,
  PagedResult,
  QiblaDirectionResponse,
  QuranApiResponse,
  QuranAyah,
  QuranEdition
} from '../models';

@Injectable({ providedIn: 'root' })
export class IslamicContentService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  summary() {
    return this.http.get<IslamicContentSummary>(`${this.base}/api/v1/islamic-content/summary`);
  }

  syncStatus() {
    return this.http.get<IslamicContentSyncState[]>(`${this.base}/api/v1/islamic-content/status`);
  }

  quranEditions(filters: { language?: string; format?: string; type?: string } = {}) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params = params.set(key, value);
    });
    return this.http.get<{ data: QuranEdition[]; total: number }>(
      `${this.base}/api/v1/islamic-content/quran/editions`, { params });
  }

  syncQuran(scope: 'catalog' | 'text' | 'all') {
    return this.http.post<{ provider: string; scope: string; status: string }>(
      `${this.base}/api/v1/islamic-content/sync/quran`, { scope });
  }

  syncHadith() {
    return this.http.post<{ provider: string; scope: string; status: string }>(
      `${this.base}/api/v1/islamic-content/sync/hadith`, {});
  }

  randomAyah() {
    return this.http.get<QuranApiResponse<QuranAyah[]>>(
      `${this.base}/public/content/quran/showcase/random`);
  }

  ayahRecitation(number: number, edition: string) {
    return this.http.get<QuranApiResponse<QuranAyah>>(
      `${this.base}/public/content/quran/showcase/ayah/${number}/recitation/${encodeURIComponent(edition)}`);
  }

  hadithBooks() {
    return this.http.get<{ data: HadithBook[]; total: number }>(
      `${this.base}/public/content/hadith/books`);
  }

  searchHadiths(filters: {
    book?: string;
    search?: string;
    language?: string;
    page?: number;
    pageSize?: number;
  }) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    });
    return this.http.get<PagedResult<HadithRecord>>(
      `${this.base}/public/content/hadith/hadiths`, { params });
  }

  randomHadith(filters: { book?: string; language?: string } = {}) {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params = params.set(key, value);
    });
    return this.http.get<{ data: HadithRecord }>(
      `${this.base}/public/content/hadith/hadiths/random`, { params });
  }

  qiblaDirection(latitude: number, longitude: number) {
    return this.http.get<QiblaDirectionResponse>(
      `${this.base}/public/content/qibla/${latitude}/${longitude}`);
  }

  qiblaCompass(latitude: number, longitude: number) {
    return this.http.get(
      `${this.base}/public/content/qibla/${latitude}/${longitude}/compass`,
      { responseType: 'blob' });
  }

  apiClients(organizationId: string) {
    return this.http.get<{ data: ApiClientAccess[]; supportedScopes: string[] }>(
      `${this.base}/api/v1/orgs/${organizationId}/api-clients`);
  }

  createApiClient(organizationId: string, name: string, requestsPerMinute: number) {
    return this.http.post<IssuedApiClient>(
      `${this.base}/api/v1/orgs/${organizationId}/api-clients`, {
        name,
        scopes: ['content:read'],
        requestsPerMinute
      });
  }

  rotateApiClient(organizationId: string, clientId: string) {
    return this.http.post<IssuedApiClient>(
      `${this.base}/api/v1/orgs/${organizationId}/api-clients/${clientId}/rotate`, {});
  }

  revokeApiClient(organizationId: string, clientId: string) {
    return this.http.post<void>(
      `${this.base}/api/v1/orgs/${organizationId}/api-clients/${clientId}/revoke`, {});
  }
}
