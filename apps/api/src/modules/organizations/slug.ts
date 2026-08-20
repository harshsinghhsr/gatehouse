/**
 * Slugs are used as gateway namespaces and appear in model names, so they are restricted to
 * lowercase alphanumerics and single dashes.
 */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'org';
}
