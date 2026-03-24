import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { PublishArtifact, PdfGenerateRequest } from '../models';

@Injectable({ providedIn: 'root' })
export class PublishService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  generatePdf(req: PdfGenerateRequest) {
    return this.http.post<PublishArtifact>(`${this.base}/api/v1/publish/pdf/generate`, req);
  }

  listArtifacts(orgId: string, year: number) {
    return this.http.get<PublishArtifact[]>(`${this.base}/api/v1/publish/artifacts`, { params: { orgId, year } });
  }

  getEmbedCode(orgId: string) {
    return this.http.get<{ iframe: string; script: string }>(`${this.base}/api/v1/publish/embed-code/${orgId}`);
  }

  getTvConfig(orgId: string) {
    return this.http.get<any>(`${this.base}/api/v1/publish/tv-config/${orgId}`);
  }
}
