import { captureProfileConfig, getActiveProfile } from './profile.js';

const MANAGED_PUBLIC_API_PATTERN =
  /^https:\/\/(?:dev-api\.au|(?:test-api|api)\.(?:au|ca|eu))\.myenterprise\.ai\/public\/?$/;

function configuredEndpoint(value: string): string {
  if (value.includes('\\')) throw new Error('Managed profile endpoint must be a canonical HTTPS root or /public URL.');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Managed profile endpoint must be a canonical HTTPS root or /public URL.'); }
  const normalized = value.replace(/\/$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !['/', '/public', '/public/'].includes(url.pathname)
    || normalized !== `${url.origin}${url.pathname.replace(/\/$/, '')}`) {
    throw new Error('Managed profile endpoint must be a canonical HTTPS root or /public URL.');
  }
  return normalized;
}

/** SECURITY: defaults stay regional-only; an owner-controlled named profile may explicitly pin one managed HTTPS gateway. */
export function requireManagedPublicApiUrl(value: string): string {
  const profile = captureProfileConfig(getActiveProfile());
  if (profile?.managedDeploymentApiUrl !== undefined) {
    const authorized = configuredEndpoint(profile.managedDeploymentApiUrl);
    if (authorized !== configuredEndpoint(profile.publicApiUrl) || authorized !== configuredEndpoint(value)) {
      throw new Error('Managed deployment endpoint must exactly match its authorized named profile gateway.');
    }
    return authorized;
  }
  if (!MANAGED_PUBLIC_API_PATTERN.test(value)) {
    throw new Error(
      'Managed deployment requires a trusted EAI regional PublicAPI HTTPS URL ending in /public.',
    );
  }
  return value.replace(/\/$/, '');
}
