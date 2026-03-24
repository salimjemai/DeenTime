import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { HijriMonthMap } from '../models';

@Injectable({ providedIn: 'root' })
export class HijriService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  list(orgId: string, from: string, to: string) {
    return this.http.get<HijriMonthMap[]>(`${this.base}/api/v1/hijri/${orgId}`, { params: { from, to } });
  }

  create(body: Partial<HijriMonthMap>) {
    return this.http.post<HijriMonthMap>(`${this.base}/api/v1/hijri`, body);
  }

  update(id: string, body: Partial<HijriMonthMap>) {
    return this.http.put<HijriMonthMap>(`${this.base}/api/v1/hijri/${id}`, body);
  }

  regenerate(orgId: string, from: string, to: string) {
    return this.http.post<void>(`${this.base}/api/v1/hijri/regenerate/${orgId}`, null, { params: { from, to } });
  }
}
