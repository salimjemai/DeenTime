import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { PublicDisplay } from '../models';

@Injectable({ providedIn: 'root' })
export class PublicDisplayService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  get(slug: string) {
    return this.http.get<PublicDisplay>(`${this.base}/public/display/${slug}`);
  }
}
