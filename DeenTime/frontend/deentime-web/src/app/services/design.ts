import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { DesignSettings, DesignRequest } from '../models';

@Injectable({ providedIn: 'root' })
export class DesignService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  get(orgId: string) {
    return this.http.get<DesignSettings>(`${this.base}/api/v1/design/${orgId}`);
  }

  put(orgId: string, body: DesignRequest) {
    return this.http.put<void>(`${this.base}/api/v1/design/${orgId}`, body);
  }
}
