/**
 * In a production build the API lives on its own host, so VITE_API_BASE must be the API's absolute HTTPS URL
 * (for example https://api.trynook.in/api/v1). A relative or plain-HTTP value would send API calls to the web
 * host or over an insecure channel, and the session cookies (Secure, host-only on the API host) would not work.
 * An unset value is allowed with a warning so local builds and CI still work; the Vercel project must set it.
 */
export function checkApiBase(mode: string, value: string | undefined): string | null {
  if (mode !== 'production') return null;
  if (!value) {
    return 'VITE_API_BASE is not set: this build calls the relative path /api/v1 and will not reach the API on a separate host.';
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_API_BASE must be an absolute URL such as https://api.trynook.in/api/v1');
  }
  if (url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE must use https:// in a production build');
  }
  return null;
}
