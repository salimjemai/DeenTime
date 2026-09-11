import { DevTestMasjid } from '../app/models';

export const environment = {
  production: true,
  apiUrl: '',
  devSuperUser: null as { email: string; password: string } | null,
  devTestMasjid: null as DevTestMasjid | null
};
