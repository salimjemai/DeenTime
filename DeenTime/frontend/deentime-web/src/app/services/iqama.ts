import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { IqamaEntry, IqamaScheduleUpsertRequest, IqamaUpsertRequest } from '../models';

@Injectable({ providedIn: 'root' })
export class IqamaService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  list(orgId: string, year: number) {
    return this.http.get<IqamaEntry[]>(`${this.base}/api/v1/iqama`, { params: { orgId, year } });
  }

  current(orgId: string, date: string) {
    return this.http.get<IqamaEntry[]>(`${this.base}/api/v1/iqama/current`, { params: { orgId, date } });
  }

  saveSchedule(body: IqamaScheduleUpsertRequest) {
    return this.http.put<IqamaEntry[]>(`${this.base}/api/v1/iqama/schedule`, body);
  }

  create(body: IqamaUpsertRequest) {
    return this.http.post<IqamaEntry>(`${this.base}/api/v1/iqama`, body);
  }

  update(id: string, body: IqamaUpsertRequest) {
    return this.http.put<IqamaEntry>(`${this.base}/api/v1/iqama/${id}`, body);
  }

  delete(id: string) {
    return this.http.delete<void>(`${this.base}/api/v1/iqama/${id}`);
  }
}
