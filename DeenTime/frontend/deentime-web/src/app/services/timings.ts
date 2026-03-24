import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { PrayerTimesDto } from '../models';

@Injectable({ providedIn: 'root' })
export class TimingsService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  getToday(orgId: string) {
    return this.http.get<PrayerTimesDto>(`${this.base}/api/v1/timings/today`, { params: { orgId } });
  }

  getForDate(orgId: string, date: string) {
    return this.http.get<PrayerTimesDto>(`${this.base}/api/v1/timings`, { params: { orgId, date } });
  }

  getRange(orgId: string, from: string, to: string) {
    return this.http.get<PrayerTimesDto[]>(`${this.base}/api/v1/timings/range`, { params: { orgId, from, to } });
  }
}
