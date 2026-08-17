import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { LoginRequest, RegisterRequest, AuthResponse } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http   = inject(HttpClient);
  private router = inject(Router);
  private base   = environment.apiUrl;

  readonly isLoggedIn = signal(!!this.getToken());

  login(req: LoginRequest) {
    return this.http.post<AuthResponse>(`${this.base}/api/v1/auth/login`, req).pipe(
      tap(res => this.storeToken(res.token))
    );
  }

  register(req: RegisterRequest) {
    return this.http.post<AuthResponse>(`${this.base}/api/v1/auth/register`, req).pipe(
      tap(res => this.storeToken(res.token))
    );
  }

  logout() {
    localStorage.removeItem('token');
    this.isLoggedIn.set(false);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getPayload(): Record<string, unknown> | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1]));
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

  private storeToken(token: string) {
    localStorage.setItem('token', token);
    this.isLoggedIn.set(true);
  }
}
