import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map } from 'rxjs';
import { environment } from '../../environments/environment';

export type SalahName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const SALAH: { key: SalahName; label: string }[] = [
  { key: 'fajr', label: 'Fajr' },
  { key: 'dhuhr', label: 'Dhuhr' },
  { key: 'asr', label: 'Asr' },
  { key: 'maghrib', label: 'Maghrib' },
  { key: 'isha', label: 'Isha' }
];
export const CALCULATION_METHODS = [
  { value: 'ISNA', label: 'ISNA (North America)' },
  { value: 'MWL', label: 'Muslim World League' },
  { value: 'Egyptian', label: 'Egyptian General Authority' },
  { value: 'Karachi', label: 'University of Karachi' },
  { value: 'UmmAlQura', label: 'Umm al-Qura (Makkah)' },
  { value: 'Gulf', label: 'Gulf region' },
  { value: 'Kuwait', label: 'Kuwait' },
  { value: 'Qatar', label: 'Qatar' },
  { value: 'Tehran', label: 'Tehran' },
  { value: 'Jafari', label: 'Jafari' }
];

export type IqamaRule = { mode: 'none' } | { mode: 'fixed'; time: string } | { mode: 'offset'; minutes: number };

export interface WidgetSettings {
  theme: 'light' | 'dark';
  accent: string;
  showIqama: boolean;
  showMessages: boolean;
  showJumuah: boolean;
}

export interface Masjid {
  id: string;
  slug: string;
  name: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  websiteUrl: string;
  phone: string;
  email: string;
  about: string;
  calculationMethod: string;
  asrMethod: string;
  iqama: Partial<Record<SalahName, IqamaRule>>;
  jumuah: string[];
  widget: WidgetSettings;
}

export interface MasjidMessage {
  id: string;
  title: string;
  body: string;
  startsOn: string | null;
  endsOn: string | null;
  pinned: boolean;
}

export interface PrayerTimes {
  date: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  sunset: string;
  isha: string;
}

export interface PublicMasjid {
  masjid: Omit<Masjid, 'id' | 'latitude' | 'longitude' | 'iqama'>;
  date: string;
  prayerTimes: PrayerTimes | null;
  iqama: Partial<Record<SalahName, string>>;
  messages: MasjidMessage[];
}

export type MasjidInput = Partial<Omit<Masjid, 'id' | 'slug'>>;

/** The masjid admin API served by the Cloudflare Worker at /masjid/api/v1. */
@Injectable({ providedIn: 'root' })
export class MasjidApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.masjidApiUrl.replace(/\/+$/, '');

  myMasjids() {
    return this.http.get<{ masjids: Masjid[] }>(`${this.base}/me/masjids`).pipe(map(r => r.masjids));
  }
  get(id: string) {
    return this.http.get<{ masjid: Masjid }>(`${this.base}/masjids/${id}`).pipe(map(r => r.masjid));
  }
  create(input: MasjidInput) {
    return this.http.post<{ masjid: Masjid }>(`${this.base}/masjids`, input).pipe(map(r => r.masjid));
  }
  update(id: string, input: MasjidInput) {
    return this.http.put<{ masjid: Masjid }>(`${this.base}/masjids/${id}`, input).pipe(map(r => r.masjid));
  }
  messages(id: string) {
    return this.http.get<{ messages: MasjidMessage[] }>(`${this.base}/masjids/${id}/messages`).pipe(map(r => r.messages));
  }
  addMessage(id: string, message: Omit<MasjidMessage, 'id'>) {
    return this.http.post<{ message: MasjidMessage }>(`${this.base}/masjids/${id}/messages`, message).pipe(map(r => r.message));
  }
  updateMessage(id: string, message: MasjidMessage) {
    return this.http.put<{ message: MasjidMessage }>(`${this.base}/masjids/${id}/messages/${message.id}`, message).pipe(map(r => r.message));
  }
  deleteMessage(id: string, messageId: string) {
    return this.http.delete<void>(`${this.base}/masjids/${id}/messages/${messageId}`);
  }
  publicMasjid(slug: string) {
    return this.http.get<PublicMasjid>(`${this.base}/public/masjids/${encodeURIComponent(slug)}`);
  }
  lookupPostalCode(country: string, code: string) {
    return this.http.get<{ city: string; region: string; latitude: number; longitude: number }>(`${this.base}/locate/postal-code`, { params: { country, code } });
  }
}
