import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  CreateMasjidInvitationRequest,
  MasjidAdminDashboard,
  MasjidInvitationResponse
} from '../models';

@Injectable({ providedIn: 'root' })
export class AdminMasjidsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/v1/admin/masjids`;

  getDashboard() {
    return this.http.get<MasjidAdminDashboard>(this.base);
  }

  invite(request: CreateMasjidInvitationRequest) {
    return this.http.post<MasjidInvitationResponse>(`${this.base}/invitations`, request);
  }

  resend(id: string) {
    return this.http.post<{ message: string; expiresAtUtc: string; developmentInvitationUrl?: string }>(
      `${this.base}/invitations/${id}/resend`, {});
  }

  revoke(id: string) {
    return this.http.post<void>(`${this.base}/invitations/${id}/revoke`, {});
  }
}
