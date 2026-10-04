// ai-service -> media-service handoff, per the brief: "Do NOT persist
// generated image files inside ai-service container. Media bytes/metadata
// belong to media-service." Uses the internal endpoint media-service built
// for exactly this (POST /internal/assets), finally wiring up a real
// caller to it — the monolith still writes directly to media-assets.ts for
// its own generate-image route, unchanged; this is ai-service's own path.

export function createMediaClient({ mediaServiceUrl, internalSecret }) {
  return {
    async persistGeneratedImage({ userId, filename, mime, bytes, altText }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${mediaServiceUrl}/internal/assets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
          body: JSON.stringify({ userId, filename, mime, bytesBase64: bytes.toString('base64'), source: 'AI_GENERATED', altText }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.asset) return { ok: false, error: data.error || `media-service returned ${res.status}` };
        return { ok: true, asset: data.asset };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Network error reaching media-service' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
