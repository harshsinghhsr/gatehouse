import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UpstreamError, ValidationError } from '../../../core/errors.js';

/**
 * An administrator-supplied base URL is fetched with our own network position, which makes it
 * a server-side request forgery vector. A URL must be https, carry no credentials, match the
 * provider's allowed hosts, and resolve exclusively to public addresses.
 */
export async function assertSafeBaseUrl(raw: string, allowedHostSuffixes: readonly string[]): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Base URL is not a valid URL');
  }

  if (url.protocol !== 'https:') throw new ValidationError('Base URL must use https');
  if (url.username || url.password) throw new ValidationError('Base URL must not contain credentials');

  const host = url.hostname.toLowerCase();
  const allowed = allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) {
    throw new ValidationError(`Base URL host must be one of: ${allowedHostSuffixes.join(', ')}`);
  }

  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new ValidationError('Base URL host does not resolve');
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new ValidationError('Base URL resolves to a private address');
  }
  return url;
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) return isPrivateIpv6(address.toLowerCase());

  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
  const [a = 0, b = 0] = octets;

  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, covers the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

function isPrivateIpv6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  if (/^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  return mapped?.[1] ? isPrivateAddress(mapped[1]) : false;
}

/** Shared probe for credential verification. Redirects are refused, not followed. */
export async function listModels(url: string, headers: Record<string, string>): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new UpstreamError(`Could not reach the provider: ${String(error).slice(0, 120)}`, 'provider_unreachable');
  }

  if (response.status === 401 || response.status === 403) {
    throw new ValidationError('The provider rejected this credential');
  }
  if (!response.ok) throw new UpstreamError(`The provider returned ${response.status}`, 'provider_error');

  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).flatMap((model) => (model.id ? [model.id] : []));
}
