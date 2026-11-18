import type { Ctx } from '../../core/context.js';
import { IslamicContentOptions } from '../../integrations/islamic-content/islamic-content-options.js';
import { QiblaProviderClient } from '../../integrations/islamic-content/qibla-provider.client.js';
import { QuranProviderClient } from '../../integrations/islamic-content/quran-provider.client.js';

/**
 * IslamicContentProvidersModule: the options and the provider clients request handlers
 * use, one set per isolate (the Qibla client keeps its direction cache in memory).
 * The Hadith client is only used by the offline sync, never by a request.
 */
export interface ContentProviders {
  options: IslamicContentOptions;
  quran: QuranProviderClient;
  qibla: QiblaProviderClient;
}

const cache = new WeakMap<object, ContentProviders>();

export function contentProviders(c: Ctx): ContentProviders {
  const services = c.get('services');
  let providers = cache.get(services);
  if (!providers) {
    // Throws when a base URL is not the primary documented server (backend-node refuses to start).
    const options = IslamicContentOptions.fromConfig(services.config);
    providers = { options, quran: new QuranProviderClient(services.db, options), qibla: new QiblaProviderClient(options) };
    cache.set(services, providers);
  }
  return providers;
}
