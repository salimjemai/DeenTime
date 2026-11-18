import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { CloudAuthResponse, CloudUser, SHARED_AUTH_PATHS } from './shared-auth.contract';

const TOKEN_KEY = 'jemai.auth.token';

/** Sign-up, sign-in and the current user, against the shared auth service. */
@Injectable({ providedIn: 'root' })
export class CloudAuthService {
  private readonly http = inject(HttpClient);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly base = environment.authApiUrl.replace(/\/+$/, '');
  readonly user = signal<CloudUser | null>(null);

  signUp(email: string, password: string, displayName: string): Observable<CloudUser | null> {
    return this.http
      .post<CloudAuthResponse>(`${this.base}${SHARED_AUTH_PATHS.signUp}`, { email: email.trim(), password, displayName: displayName.trim() || undefined })
      .pipe(tap(res => this.store(res)), map(res => res.user ?? null));
  }

  signIn(email: string, password: string): Observable<CloudUser | null> {
    return this.http
      .post<CloudAuthResponse>(`${this.base}${SHARED_AUTH_PATHS.signIn}`, { email: email.trim(), password })
      .pipe(tap(res => this.store(res)), map(res => res.user ?? null));
  }

  forgotPassword(email: string) {
    return this.http.post<{ message?: string }>(`${this.base}${SHARED_AUTH_PATHS.forgotPassword}`, { email: email.trim() });
  }

  /** The signed-in user, or null when there is no usable session. */
  current(): Observable<CloudUser | null> {
    if (!this.token()) return of(null);
    if (this.user()) return of(this.user());
    return this.http.get<{ user?: CloudUser } & Partial<CloudUser>>(`${this.base}${SHARED_AUTH_PATHS.me}`).pipe(
      map(body => (body.user ?? (body.id ? (body as CloudUser) : null))),
      tap(user => this.user.set(user)),
      catchError(() => {
        this.clear();
        return of(null);
      })
    );
  }

  signOut(): void {
    const token = this.token();
    if (token) this.http.post(`${this.base}${SHARED_AUTH_PATHS.signOut}`, {}).subscribe({ error: () => undefined });
    this.clear();
  }

  token(): string | null {
    return this.browser ? localStorage.getItem(TOKEN_KEY) : null;
  }

  /** Requests that should carry the bearer token: the shared auth service and our masjid API. */
  isOwnApi(url: string): boolean {
    return url.startsWith(`${this.base}/`) || url.startsWith(environment.masjidApiUrl);
  }

  clear(): void {
    if (this.browser) localStorage.removeItem(TOKEN_KEY);
    this.user.set(null);
  }

  private store(res: CloudAuthResponse): void {
    if (!res?.token) throw new Error('The sign-in service did not return a session.');
    if (this.browser) localStorage.setItem(TOKEN_KEY, res.token);
    this.user.set(res.user ?? null);
  }
}
