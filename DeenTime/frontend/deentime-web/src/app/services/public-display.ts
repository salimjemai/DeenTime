import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { PublicDisplay } from '../models';

export interface PublicDisplayOptions {
  locale?: string;
  theme?: string;
  fontScale?: string | number;
}

@Injectable({ providedIn: 'root' })
export class PublicDisplayService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  get(slug: string, layout?: 'tv' | 'widget' | 'compact', options: PublicDisplayOptions = {}) {
    const params: Record<string, string> = layout ? { layout } : {};
    if (options.locale) params['locale'] = options.locale;
    if (options.theme) params['theme'] = options.theme;
    if (options.fontScale !== undefined && options.fontScale !== '') params['fontScale'] = String(options.fontScale);
    return this.http.get<PublicDisplay>(`${this.base}/public/display/${slug}`, { params });
  }
}
