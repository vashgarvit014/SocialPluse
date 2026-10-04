// Verified against Meta's generated Business SDK create_photo/create_media.
// LinkedIn's current /v2/ugcPosts supports ALT only on article thumbnails,
// not the native image/video path used here. Do not substitute description.
export function altField(platform: string, mediaType: string): 'alt_text' | 'alt_text_custom' | null {
  if (mediaType !== 'image') return null;
  return platform === 'instagram' ? 'alt_text' : platform === 'facebook' ? 'alt_text_custom' : null;
}
export function altPayload(platform: string, mediaType: string, text: unknown): Record<string, string> {
  const field = altField(platform, mediaType);
  return field && typeof text === 'string' && text.trim() ? { [field]: text.trim().slice(0, 1000) } : {};
}
export function mediaAlt(items: Array<{ url?: string; altText?: string }> | undefined, url: string, index = 0) {
  return items?.[index]?.url === url ? items[index].altText : items?.find(item => item.url === url)?.altText;
}
