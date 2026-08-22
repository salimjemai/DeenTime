import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { PublishArtifact, PdfGenerateRequest, TvDisplayConfig } from '../models';

export type TvDisplayConfigUpdate = Pick<TvDisplayConfig,
  'showSeconds' | 'showHijri' | 'accentColor' | 'clockFontScale' | 'autoRefreshSeconds'>;

export interface PublishEmbedCode {
  widgetUrl: string;
  combinedWidgetUrl: string;
  dailyWidgetUrl: string;
  jumuahWidgetUrl: string;
  compactWidgetUrl: string;
  tvUrl: string;
  iframe: string;
  combinedIframe: string;
  dailyIframe: string;
  jumuahIframe: string;
  compactIframe: string;
  script: string;
}

export type PublishEmbedCodeResponse = Omit<PublishEmbedCode,
  'combinedWidgetUrl' | 'dailyWidgetUrl' | 'jumuahWidgetUrl' | 'combinedIframe' | 'dailyIframe' | 'jumuahIframe'>
  & Partial<Pick<PublishEmbedCode,
  'combinedWidgetUrl' | 'dailyWidgetUrl' | 'jumuahWidgetUrl' | 'combinedIframe' | 'dailyIframe' | 'jumuahIframe'>>;

export function resolvePublishEmbedCode(code: PublishEmbedCodeResponse, publicOrigin: string): PublishEmbedCode {
  const origin = new URL(publicOrigin).origin;
  const moveToAppOrigin = (value: string) => {
    const source = new URL(value, `${origin}/`);
    return new URL(`${source.pathname}${source.search}${source.hash}`, `${origin}/`).toString();
  };
  const replaceAttribute = (markup: string, attribute: 'src' | 'href' | 'height', value: string) => {
    const encoded = value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const pattern = new RegExp(`(${attribute}\\s*=\\s*")[^"]*(")`, 'i');
    if (pattern.test(markup)) {
      return markup.replace(pattern, (_match, start: string, end: string) => `${start}${encoded}${end}`);
    }

    return markup.replace(/^(\s*<[a-z][\w-]*)/i, `$1 ${attribute}="${encoded}"`);
  };
  const appendPath = (value: string, suffix: string) => {
    const source = new URL(value, `${origin}/`);
    source.pathname = `${source.pathname.replace(/\/$/, '')}/${suffix}`;
    return source.toString();
  };

  const widgetUrl = moveToAppOrigin(code.widgetUrl);
  const combinedWidgetUrl = moveToAppOrigin(code.combinedWidgetUrl ?? code.widgetUrl);
  const dailyWidgetUrl = moveToAppOrigin(code.dailyWidgetUrl ?? appendPath(code.widgetUrl, 'daily'));
  const jumuahWidgetUrl = moveToAppOrigin(code.jumuahWidgetUrl ?? appendPath(code.widgetUrl, 'jumuah'));
  const compactWidgetUrl = moveToAppOrigin(code.compactWidgetUrl);
  const tvUrl = moveToAppOrigin(code.tvUrl);
  const dailyMarkup = code.dailyIframe ?? replaceAttribute(code.iframe, 'height', '720');
  const jumuahMarkup = code.jumuahIframe ?? replaceAttribute(code.iframe, 'height', '560');
  return {
    ...code,
    widgetUrl,
    combinedWidgetUrl,
    dailyWidgetUrl,
    jumuahWidgetUrl,
    compactWidgetUrl,
    tvUrl,
    iframe: replaceAttribute(code.iframe, 'src', widgetUrl),
    combinedIframe: replaceAttribute(code.combinedIframe ?? code.iframe, 'src', combinedWidgetUrl),
    dailyIframe: replaceAttribute(dailyMarkup, 'src', dailyWidgetUrl),
    jumuahIframe: replaceAttribute(jumuahMarkup, 'src', jumuahWidgetUrl),
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
    return this.http.get<PublishEmbedCodeResponse>(`${this.base}/api/v1/publish/embed-code/${orgId}`, {
      params: { publicOrigin }
    });
  }

  getTvConfig(orgId: string) {
    return this.http.get<TvDisplayConfig>(`${this.base}/api/v1/publish/tv-config/${orgId}`);
  }

  updateTvConfig(orgId: string, body: TvDisplayConfigUpdate) {
    return this.http.put<TvDisplayConfig>(`${this.base}/api/v1/publish/tv-config/${orgId}`, body);
  }
}
