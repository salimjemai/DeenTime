import type { Ctx } from './context.js';

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** 4 or 6 like node:net isIP, 0 when the text is not an IP address. */
export function isIP(value: string): 0 | 4 | 6 {
  if (IPV4.test(value)) return 4;
  return isIPv6(value) ? 6 : 0;
}

function isIPv6(input: string): boolean {
  let value = input;
  const zone = value.indexOf('%');
  if (zone >= 0) {
    if (zone === value.length - 1) return false;
    value = value.slice(0, zone);
  }
  if (value.length < 2 || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  const halves = value.split('::');
  if (halves.length > 2) return false;
  const groups = (part: string): string[] | null => {
    if (part === '') return [];
    const items = part.split(':');
    return items.every((item) => item !== '') ? items : null;
  };
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  if (!head || !tail) return false;
  const all = [...head, ...tail];
  let count = all.length;
  const last = all[all.length - 1];
  if (last !== undefined && last.includes('.')) {
    if (!IPV4.test(last)) return false;
    all.pop();
    count += 1;
  }
  if (!all.every((item) => /^[0-9a-fA-F]{1,4}$/.test(item))) return false;
  return halves.length === 2 ? count <= 7 : count === 8;
}

/**
 * The visitor address used for IP-partitioned rate limits and Turnstile. On Cloudflare
 * the edge sets CF-Connecting-IP and callers cannot forge it; as in backend-node, a
 * value that is not an IP address is ignored (the caller then partitions on "unknown").
 */
export function clientAddress(c: Ctx): string | undefined {
  const value = c.req.header('CF-Connecting-IP')?.trim();
  return value && isIP(value) !== 0 ? value : undefined;
}
