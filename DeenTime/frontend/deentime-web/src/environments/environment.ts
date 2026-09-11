import { DevTestMasjid } from '../app/models';

export const environment = {
  production: false,
  apiUrl: 'http://localhost:8080',
  devSuperUser: null as { email: string; password: string } | null,
  // Local-only masjid administrator used by the "Quick Login (Test Masjid)" button on the
  // sign-in page. The first click registers and verifies it through the API's development
  // verification link; later clicks simply sign in. Never shipped in production builds.
  devTestMasjid: {
    email: 'dev-test-masjid@example.org',
    password: 'TestMasjid-Dev-2026!',
    organizationName: 'Dev Test Masjid',
    websiteUrl: 'https://dev-test-masjid.example.org',
    addressLine: '100 Test Street',
    city: 'Austin',
    state: 'TX',
    zipCode: '78717'
  } as DevTestMasjid | null
};
