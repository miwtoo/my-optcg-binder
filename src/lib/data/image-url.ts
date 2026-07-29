/** Resolve a generated card image path against the app's deployment base. */
export function resolveCardImagePath(baseUrl: string, image: string | null | undefined): string {
  if (!image) return '';
  if (image.startsWith('/')) return image;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${image.replace(/^\/+/, '')}`;
}
