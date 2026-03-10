/** Max size for data URL (OpenAI allows up to 20MB per image; ~27MB as base64). We use 10MB to be safe. */
const MAX_DATA_URL_LENGTH = 10 * 1024 * 1024;

/**
 * Returns true if the string is a valid image URL for the API (http(s) or data URL with valid base64).
 */
export function isValidImageUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  if (/^https?:\/\//i.test(url)) return true;
  if (!url.startsWith('data:image/')) return false;
  if (url.length > MAX_DATA_URL_LENGTH) return false;
  const comma = url.indexOf(',');
  if (comma === -1) return false;
  const base64 = url.slice(comma + 1).trim();
  if (base64.length < 50) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return false;
  return true;
}

/**
 * Filters an array of image URL strings to only valid ones.
 */
export function filterValidImageUrls(urls: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter((u) => isValidImageUrl(u));
}
