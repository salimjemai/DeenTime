import { DevTestMasjid } from '../app/models';

/**
 * Build for Cloudflare (npm run build -- --configuration cloudflare --base-href /masjid/).
 * Accounts and masjid data both come from the one shared backend (the Mushaf+ Worker
 * at api.jemaiinnovations.com, with the masjid module mounted at /v1/masjid).
 * Nothing here is secret.
 */
export const environment = {
  production: true,
  backend: 'cloudflare' as 'legacy' | 'cloudflare',
  authApiUrl: 'https://api.jemaiinnovations.com',
  masjidApiUrl: 'https://api.jemaiinnovations.com/v1/masjid',
  apiUrl: '',
  devSuperUser: null as { email: string; password: string } | null,
  devTestMasjid: null as DevTestMasjid | null
};
