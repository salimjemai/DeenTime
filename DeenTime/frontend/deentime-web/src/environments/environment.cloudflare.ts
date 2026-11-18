import { DevTestMasjid } from '../app/models';

/**
 * Build for Cloudflare (npm run build -- --configuration cloudflare --base-href /masjid/).
 * Accounts come from the shared Jemai Innovations auth service; masjid data from the
 * Worker in DeenTime/cloudflare. Nothing here is secret.
 */
export const environment = {
  production: true,
  backend: 'cloudflare' as 'legacy' | 'cloudflare',
  authApiUrl: 'https://api.jemaiinnovations.com',
  masjidApiUrl: 'api/v1',
  apiUrl: '',
  devSuperUser: null as { email: string; password: string } | null,
  devTestMasjid: null as DevTestMasjid | null
};
