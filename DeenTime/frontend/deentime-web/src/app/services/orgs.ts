import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Organization, OrganizationUpdateRequest, PrayerTimingCriteria, PagedResult } from '../models';

@Injectable({ providedIn: 'root' })
export class OrgsService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  list(search = '', page = 1) {
    return this.http.get<PagedResult<Organization>>(`${this.base}/api/v1/orgs`, { params: { search, page } });
  }

  get(idOrSlug: string) {
    return this.http.get<Organization>(`${this.base}/api/v1/orgs/${idOrSlug}`);
  }

  update(id: string, body: OrganizationUpdateRequest) {
    return this.http.put<void>(`${this.base}/api/v1/orgs/${id}`, body);
  }

  getCriteria(id: string) {
    return this.http.get<PrayerTimingCriteria>(`${this.base}/api/v1/orgs/${id}/criteria`);
  }

  putCriteria(id: string, body: PrayerTimingCriteria) {
    return this.http.put<void>(`${this.base}/api/v1/orgs/${id}/criteria`, body);
  }
}
