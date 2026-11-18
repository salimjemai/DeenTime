/**
 * The product name lives in one file: DeenTime/brand.json. Rename the app there and both
 * the web app and the Cloudflare Worker pick it up on the next build.
 */
import brandJson from '../../../../brand.json';

export interface Brand {
  name: string;
  shortName: string;
  tagline: string;
  supportEmail: string;
}

export const BRAND: Brand = brandJson;
