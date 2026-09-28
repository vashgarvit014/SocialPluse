// Instagram Trial Reel publishing — real Meta API integration.
//
// Docs (Instagram Platform, Facebook Login flow):
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
// Trial reels are REELS containers with `trial_params: { graduation_strategy }`.
// graduation_strategy is MANUAL (graduate in-app later) or SS_PERFORMANCE
// (auto-graduate if the trial performs well).
//
// Trial posts must NEVER silently fall through to a normal Reel publish (a
// normal Reel goes to followers; a Trial Reel must not). The API route must
// return on trial success instead of continuing to the normal flow.
//
// MOCK_TRIAL_REELS=true is an explicit opt-in dry run for UI testing only:
// it simulates without posting anything and is always labeled as mock.
import 'server-only';

const TRIAL_GRAPH = 'https://graph.facebook.com/v26.0';

export interface TrialReelRequest {
  caption?: string;
  videoUrl: string;
  coverUrl?: string;
  graduationStrategy?: 'MANUAL' | 'SS_PERFORMANCE';
  collaborators?: string[];
  igUserId: string;
  token: string;
  attemptId: string;
}

export interface TrialReelResult {
  ok: boolean;
  code: string;
  message: string;
  status: number;
  postId?: string;
  mock?: boolean;
}

function normalizeCollaborators(input?: string[]): string[] | undefined {
  if (!input || input.length === 0) return undefined;
  const names = input
    .flatMap((c) => String(c).split(/[,\s]+/))
    .map((c) => c.trim().replace(/^@+/, ''))
    .filter(Boolean)
    .slice(0, 3);
  return names.length > 0 ? names : undefined;
}

function metaDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message || '';
  } catch {
    return '';
  }
}

async function waitForTrialContainer(containerId: string, token: string): Promise<void> {
  for (let check = 0; check < 12; check++) {
    const res = await fetch(
      `${TRIAL_GRAPH}/${containerId}?fields=status_code,status`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) {
      const detail = metaDetail(await res.text());
      throw new Error(
        detail
          ? `Instagram trial container check failed (${res.status}): ${detail.slice(0, 200)}`
          : `Instagram trial container check failed (${res.status}).`,
      );
    }
    const data = (await res.json()) as { status_code?: string };
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error('Instagram could not process this trial video. Check its format and try again. The post was not published.');
    }
    if (check < 11) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Instagram is still processing the trial video. The post was not published; try again later.');
}

export async function publishInstagramTrialReel(req: TrialReelRequest): Promise<TrialReelResult> {
  if (process.env.MOCK_TRIAL_REELS === 'true') {
    return {
      ok: true,
      code: 'TRIAL_REEL_MOCK_SUCCESS',
      message: 'Trial Reel simulated (mock mode — nothing was posted to Instagram).',
      status: 200,
      postId: `mock_${req.attemptId}`,
      mock: true,
    };
  }

  if (!req.videoUrl) {
    return { ok: false, code: 'INSTAGRAM_MEDIA_REQUIRED', message: 'Instagram Trial Reels require a video — text-only posts are not supported by the API.', status: 400 };
  }
  if (!req.igUserId || !req.token) {
    return { ok: false, code: 'INSTAGRAM_NOT_CONNECTED', message: 'Instagram is not connected. Connect Facebook (with a linked Instagram Business account) before publishing.', status: 401 };
  }

  const collaborators = normalizeCollaborators(req.collaborators);
  const containerBody: Record<string, unknown> = {
    media_type: 'REELS',
    video_url: req.videoUrl,
    caption: req.caption || '',
    trial_params: { graduation_strategy: req.graduationStrategy ?? 'MANUAL' },
    access_token: req.token,
  };
  if (req.coverUrl) containerBody.cover_url = req.coverUrl;
  if (collaborators) containerBody.collaborators = collaborators;

  let containerRes: Response;
  try {
    containerRes = await fetch(`${TRIAL_GRAPH}/${req.igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerBody),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.error(`[instagram-trial] container network failure (attempt ${req.attemptId}):`, e instanceof Error ? e.message : e);
    return { ok: false, code: 'INSTAGRAM_PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Instagram trial publish failed; no retry was attempted.', status: 502 };
  }
  if (!containerRes.ok) {
    const text = await containerRes.text();
    const detail = metaDetail(text);
    const suffix = detail ? ` ${detail.slice(0, 200)}` : '';
    if (containerRes.status === 401) {
      return { ok: false, code: 'INSTAGRAM_AUTH_EXPIRED', message: `Instagram authentication expired during trial container creation (401). Please reconnect and try again.${suffix}`, status: 502 };
    }
    if (containerRes.status === 403) {
      return { ok: false, code: 'INSTAGRAM_PERMISSION_DENIED', message: `Instagram denied permission during trial container creation (403). Check scopes, then try again.${suffix}`, status: 502 };
    }
    if (containerRes.status === 429) {
      return { ok: false, code: 'INSTAGRAM_RATE_LIMIT', message: 'Instagram rate limit reached (429). Please wait a while and try again manually.', status: 429 };
    }
    return { ok: false, code: 'INSTAGRAM_TRIAL_REEL_FAILED', message: `Instagram trial container creation failed (${containerRes.status}).${suffix} The post was NOT published.`, status: 502 };
  }
  const containerData = (await containerRes.json()) as { id?: string };
  if (!containerData.id) {
    return { ok: false, code: 'INSTAGRAM_MEDIA_UPLOAD_FAILED', message: 'Instagram did not return a trial container id. The post was NOT published.', status: 502 };
  }

  try {
    await waitForTrialContainer(containerData.id, req.token);
  } catch (e) {
    return { ok: false, code: 'INSTAGRAM_PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Instagram trial processing failed.', status: 502 };
  }

  let publishRes: Response;
  try {
    publishRes = await fetch(`${TRIAL_GRAPH}/${req.igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerData.id, access_token: req.token }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.error(`[instagram-trial] publish network failure (attempt ${req.attemptId}):`, e instanceof Error ? e.message : e);
    return { ok: false, code: 'INSTAGRAM_PUBLISH_FAILED', message: e instanceof Error ? e.message : 'Instagram trial publish failed; no retry was attempted.', status: 502 };
  }
  if (!publishRes.ok) {
    const text = await publishRes.text();
    const detail = metaDetail(text);
    const suffix = detail ? ` ${detail.slice(0, 200)}` : '';
    if (publishRes.status === 429) {
      return { ok: false, code: 'INSTAGRAM_RATE_LIMIT', message: 'Instagram rate limit reached (429). Please wait a while and try again manually.', status: 429 };
    }
    return { ok: false, code: 'INSTAGRAM_TRIAL_REEL_FAILED', message: `Instagram trial publish failed (${publishRes.status}).${suffix}`, status: 502 };
  }
  const publishData = (await publishRes.json()) as { id?: string };
  return {
    ok: true,
    code: 'TRIAL_REEL_PUBLISHED',
    message: 'Trial Reel published to Instagram (shown to non-followers first).',
    status: 200,
    postId: publishData.id,
  };
}
