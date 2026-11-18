import { DevTestMasjid } from '../app/models';

export const environment = {
  /** 'legacy' = Node API on IIS/VPS; 'cloudflare' = shared auth + masjid Worker (environment.cloudflare.ts). */
  backend: 'legacy' as 'legacy' | 'cloudflare',
  /** Shared Jemai Innovations sign-up/sign-in service (cloudflare backend only). */
  authApiUrl: 'https://api.jemaiinnovations.com',
  /** Masjid API base; relative to the page's <base href> so /masjid/api/v1 on Cloudflare. */
  masjidApiUrl: 'api/v1',
  production: true,
  apiUrl: '',
  devSuperUser: null as { email: string; password: string } | null,
  devTestMasjid: null as DevTestMasjid | null
};
