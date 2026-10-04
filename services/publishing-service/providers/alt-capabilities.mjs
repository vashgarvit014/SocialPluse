// Faithful port of src/lib/alt-capabilities.ts.
export function altField(platform, mediaType) {
  if (mediaType !== 'image') return null;
  return platform === 'instagram' ? 'alt_text' : platform === 'facebook' ? 'alt_text_custom' : null;
}
export function altPayload(platform, mediaType, text) {
  const field = altField(platform, mediaType);
  return field && typeof text === 'string' && text.trim() ? { [field]: text.trim().slice(0, 1000) } : {};
}
export function mediaAlt(items, url, index = 0) {
  return items?.[index]?.url === url ? items[index].altText : items?.find((item) => item.url === url)?.altText;
}
