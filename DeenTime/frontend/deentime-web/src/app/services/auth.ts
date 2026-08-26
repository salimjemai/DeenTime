import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, shareReplay, tap } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { LoginRequest, RegisterRequest, AuthResponse, AuthSession, RegistrationResponse, AuthPublicConfig, MasjidInvitationPrefill, AddressSuggestion, VerifiedAddress, PostalCodeLocation } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http   = inject(HttpClient);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private base   = environment.apiUrl;
  private sessionRequest?: Observable<AuthSession>;
  readonly session = signal<AuthSession | null>(null);

  readonly isLoggedIn = signal(!!this.getToken());

  login(req: LoginRequest) {
    return this.http.post<AuthResponse>(`${this.base}/api/v1/auth/login`, req).pipe(
      tap(res => this.storeToken(res.token))
    );
  }

  register(req: RegisterRequest) {
    return this.http.post<RegistrationResponse>(`${this.base}/api/v1/auth/register`, req);
  }

  verifyEmail(token: string) {
    return this.http.post<AuthResponse>(`${this.base}/api/v1/auth/verify-email`, { token }).pipe(
      tap(res => this.storeToken(res.token))
    );
  }

  getPublicConfig() {
    return this.http.get<AuthPublicConfig>(`${this.base}/api/v1/auth/config`);
  }

  getInvitation(token: string) {
    return this.http.get<MasjidInvitationPrefill>(`${this.base}/api/v1/auth/invitations/${encodeURIComponent(token)}`);
  }

  searchAddresses(input: string, sessionToken: string) {
    return this.http.get<AddressSuggestion[]>(`${this.base}/api/v1/locations/address-suggestions`, {
      params: { input, sessionToken }
    });
  }

  resolveAddress(placeId: string, sessionToken: string) {
    return this.http.get<VerifiedAddress>(`${this.base}/api/v1/locations/address-details/${encodeURIComponent(placeId)}`, {
      params: { sessionToken }
    });
  }

  resolveUsPostalCode(postalCode: string) {
    return this.http.get<PostalCodeLocation>(`${this.base}/api/v1/locations/postal-code/${encodeURIComponent(postalCode)}`);
  }

  validateSession(force = false): Observable<AuthSession> {
    const token = this.getToken();
    if (!token || !this.isTokenUsable(token)) {
      this.clearSession();
      return throwError(() => new Error('The session is missing or expired.'));
    }
    if (!force && this.sessionRequest) return this.sessionRequest;

    this.sessionRequest = this.http.get<AuthSession>(`${this.base}/api/v1/auth/session`).pipe(
      tap(current => this.session.set(current)),
      catchError(error => {
        this.clearSession();
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.sessionRequest;
  }

  logout() {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this.isBrowser() ? localStorage.getItem('token') : null;
  }

  getPayload(): Record<string, unknown> | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(encoded.padEnd(encoded.length + (4 - encoded.length % 4) % 4, '=')));
    } catch {
      return null;
    }
  }

  getOrgId(): string | null {
    const orgId = this.getPayload()?.['orgId'];
    return typeof orgId === 'string' ? orgId : null;
  }

  getEmail(): string | null {
    const email = this.getPayload()?.['email'];
    if (Array.isArray(email)) return email[0] ?? null;
    return typeof email === 'string' ? email : null;
  }

  hasValidToken(): boolean {
    const token = this.getToken();
    return !!token && this.isTokenUsable(token);
  }

  hasAdminRole(): boolean {
    return (this.session()?.roles ?? this.rolesFromPayload())
      .some(role => /admin|owner|superuser/i.test(role));
  }

  hasSuperUserRole(): boolean {
    return (this.session()?.roles ?? this.rolesFromPayload())
      .some(role => role.toLowerCase() === 'superuser');
  }

  clearSession() {
    if (this.isBrowser()) localStorage.removeItem('token');
    this.sessionRequest = undefined;
    this.session.set(null);
    this.isLoggedIn.set(false);
  }

  private storeToken(token: string) {
    if (!this.isBrowser()) return;
    localStorage.setItem('token', token);
    this.sessionRequest = undefined;
    this.session.set(null);
    this.isLoggedIn.set(true);
  }

  private isTokenUsable(token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const exp = this.getPayloadFromToken(token)?.['exp'];
    return typeof exp === 'number' && exp > Math.floor(Date.now() / 1000);
  }

  private rolesFromPayload(): string[] {
    const value = this.getPayload()?.['role'] ?? this.getPayload()?.['roles'] ?? [];
    return (Array.isArray(value) ? value : [value])
      .filter((role): role is string => typeof role === 'string');
  }

  private getPayloadFromToken(token: string): Record<string, unknown> | null {
    try {
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(encoded.padEnd(encoded.length + (4 - encoded.length % 4) % 4, '=')));
    } catch {
      return null;
    }
  }

  private isBrowser() { return isPlatformBrowser(this.platformId); }
}
