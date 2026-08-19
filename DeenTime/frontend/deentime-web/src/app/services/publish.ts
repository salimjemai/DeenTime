import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { PublishArtifact, PdfGenerateRequest, TvDisplayConfig } from '../models';

export interface PublishEmbedCode {
  widgetUrl: string;
  compactWidgetUrl: string;
  tvUrl: string;
  iframe: string;
  compactIframe: string;
  script: string;
}

export function resolvePublishEmbedCode(code: PublishEmbedCode, publicOrigin: string): PublishEmbedCode {
  const origin = new URL(publicOrigin).origin;
  const moveToAppOrigin = (value: string) => {
    const source = new URL(value, `${origin}/`);
    return new URL(`${source.pathname}${source.search}${source.hash}`, `${origin}/`).toString();
  };
  const replaceAttribute = (markup: string, attribute: 'src' | 'href', value: string) => {
    const encoded = value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const pattern = new RegExp(`(${attribute}\\s*=\\s*")[^"]*(")`, 'i');
    return markup.replace(pattern, (_match, start: string, end: string) => `${start}${encoded}${end}`);
  };

  const widgetUrl = moveToAppOrigin(code.widgetUrl);
  const compactWidgetUrl = moveToAppOrigin(code.compactWidgetUrl);
  const tvUrl = moveToAppOrigin(code.tvUrl);
  return {
    ...code,
    widgetUrl,
    compactWidgetUrl,
    tvUrl,
    iframe: replaceAttribute(code.iframe, 'src', widgetUrl),
    compactIframe: replaceAttribute(code.compactIframe, 'src', compactWidgetUrl),
    script: replaceAttribute(code.script, 'href', tvUrl)
  };
}

@Injectable({ providedIn: 'root' })
export class PublishService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  generatePdf(req: PdfGenerateRequest) {
    return this.http.post<PublishArtifact>(`${this.base}/api/v1/publish/pdf/generate`, req);
  }

  generateRamadanPdf(req: Omit<PdfGenerateRequest, 'month'>) {
    return this.http.post<PublishArtifact>(`${this.base}/api/v1/publish/pdf/ramadan`, req);
  }

  listArtifacts(orgId: string, year: number) {
    return this.http.get<PublishArtifact[]>(`${this.base}/api/v1/publish/artifacts`, { params: { orgId, year } });
  }

  getEmbedCode(orgId: string, publicOrigin: string) {
    return this.http.get<PublishEmbedCode>(`${this.base}/api/v1/publish/embed-code/${orgId}`, {
      params: { publicOrigin }
    });
  }

  getTvConfig(orgId: string) {
    return this.http.get<TvDisplayConfig>(`${this.base}/api/v1/publish/tv-config/${orgId}`);
  }

  updateTvConfig(orgId: string, body: TvDisplayConfig) {
    return this.http.put<TvDisplayConfig>(`${this.base}/api/v1/publish/tv-config/${orgId}`, body);
  }
}
