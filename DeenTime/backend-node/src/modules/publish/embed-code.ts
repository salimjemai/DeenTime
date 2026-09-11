import { escapeDataString } from '../../integrations/islamic-content/provider-http.js';

/**
 * PublishController.EmbedCode helpers: public origin resolution, the widget/TV URLs
 * and the copy-and-paste embed markup, byte-for-byte like the .NET controller.
 */
export interface EmbedCode {
  widgetUrl: string;
  combinedWidgetUrl: string;
  dailyWidgetUrl: string;
  jumuahWidgetUrl: string;
  compactWidgetUrl: string;
  tvUrl: string;
  iframe: string;
  combinedIframe: string;
  dailyIframe: string;
  jumuahIframe: string;
  compactIframe: string;
  script: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * System.Net.WebUtility.HtmlEncode (what PublishController uses, unlike the email
 * sender's HtmlEncoder.Default): & < > " and ' (as &#39;) are escaped, Latin-1
 * supplement characters (U+00A0..U+00FF) and characters outside the BMP become
 * decimal numeric entities, everything else ('+' included) passes through and an
 * unpaired surrogate is written as U+FFFD.
 */
export function webUtilityHtmlEncode(value: string): string {
  let encoded = '';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x3e) {
      switch (code) {
        case 0x3c:
          encoded += '&lt;';
          break;
        case 0x3e:
          encoded += '&gt;';
          break;
        case 0x22:
          encoded += '&quot;';
          break;
        case 0x27:
          encoded += '&#39;';
          break;
        case 0x26:
          encoded += '&amp;';
          break;
        default:
          encoded += value[index];
      }
    } else if (code >= 0xa0 && code < 0x100) {
      encoded += `&#${code};`;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      const codePoint = value.codePointAt(index) ?? code;
      if (codePoint > 0xffff) {
        encoded += `&#${codePoint};`;
        index++;
      } else {
        encoded += '�';
      }
    } else {
      encoded += value[index];
    }
  }
  return encoded;
}

/**
 * PublishController.PublicOrigin: the requested origin (query string) or Frontend:PublicBaseUrl,
 * reduced to "scheme://authority". Throws (an unhandled 500, like the InvalidOperationException)
 * unless it is an absolute http(s) URL, and outside Development unless it is a non-loopback
 * https origin.
 */
export function resolvePublicOrigin(requestedOrigin: string | undefined, configuredOrigin: string | undefined, isDevelopment: boolean): string {
  const candidate = requestedOrigin === undefined || requestedOrigin.trim() === '' ? configuredOrigin : requestedOrigin;
  const url = tryCreateAbsoluteUrl(candidate?.replace(/\/+$/, ''));
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('The public app address must be an absolute http(s) URL.');
  }
  if (!isDevelopment && (url.protocol !== 'https:' || LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error('Production public display URLs must use a non-local HTTPS origin.');
  }
  return authority(url);
}

function tryCreateAbsoluteUrl(value: string | undefined): URL | null {
  if (value === undefined) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Uri.GetLeftPart(UriPartial.Authority): scheme, user info, lower-cased host and a non-default port. */
function authority(url: URL): string {
  const userInfo = url.username === '' && url.password === '' ? '' : `${url.username}${url.password === '' ? '' : `:${url.password}`}@`;
  return `${url.protocol}//${userInfo}${url.host}`;
}

/** PublishController.PublicUrl: new Uri(origin, path.TrimStart('/')).AbsoluteUri. */
export function publicUrl(origin: string, path: string): string {
  return `${origin}/${path.replace(/^\/+/, '')}`;
}

/** The EmbedCode action's response for an organization at the given public origin. */
export function buildEmbedCode(origin: string, organization: { slug: string; name: string }): EmbedCode {
  const slug = escapeDataString(organization.slug);
  const combinedWidgetUrl = publicUrl(origin, `/w/${slug}`);
  const dailyWidgetUrl = publicUrl(origin, `/w/${slug}/daily`);
  const jumuahWidgetUrl = publicUrl(origin, `/w/${slug}/jumuah`);
  const compactWidgetUrl = publicUrl(origin, `/w2/${slug}`);
  const tvUrl = publicUrl(origin, `/tv/${slug}`);
  const encodedName = webUtilityHtmlEncode(organization.name);
  const combinedIframe = widgetIframe(origin, combinedWidgetUrl, webUtilityHtmlEncode(`IqamaTime · ${organization.name} prayer times`), '420', '900');
  const dailyIframe = widgetIframe(origin, dailyWidgetUrl, webUtilityHtmlEncode(`IqamaTime · ${organization.name} daily prayer times`), '420', '720');
  const jumuahIframe = widgetIframe(origin, jumuahWidgetUrl, webUtilityHtmlEncode(`IqamaTime · ${organization.name} Friday prayer times`), '420', '560');
  const compactIframe = widgetIframe(origin, compactWidgetUrl, webUtilityHtmlEncode(`IqamaTime · ${organization.name} compact prayer times`), '360', '800');
  return {
    widgetUrl: combinedWidgetUrl,
    combinedWidgetUrl,
    dailyWidgetUrl,
    jumuahWidgetUrl,
    compactWidgetUrl,
    tvUrl,
    iframe: combinedIframe,
    combinedIframe,
    dailyIframe,
    jumuahIframe,
    compactIframe,
    script: `<a href="${webUtilityHtmlEncode(tvUrl)}">Open ${encodedName} IqamaTime TV display</a>`,
  };
}

/** PublishController.WidgetIframe. */
function widgetIframe(origin: string, url: string, title: string, width: string, height: string): string {
  const scriptUrl = publicUrl(origin, '/iqamatime-embed.js');
  return `<iframe src="${webUtilityHtmlEncode(url)}" title="${title}" width="${webUtilityHtmlEncode(width)}" height="${webUtilityHtmlEncode(height)}" loading="lazy" data-iqamatime-auto-height style="display:block;max-width:100%;border:0;overflow:hidden"></iframe><script async src="${webUtilityHtmlEncode(scriptUrl)}"></script>`;
}
