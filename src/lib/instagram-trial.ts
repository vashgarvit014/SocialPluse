// Instagram Trial Reel publishing seam — deliberately isolated in its own
// module so the real Meta Trial Reel API integration can be connected here
// later without touching the normal Reel flow.
//
// DO NOT assume the normal publishing API supports Trial Reels: trial posts
// must never silently fall through to a regular Reel publish (a normal Reel
// goes to followers; a Trial Reel must not). Until Meta confirms Trial Reel
// API support and permissions, this seam declines with a clear code so the
// UI/scheduler can explain it instead of mis-posting.
export interface TrialReelRequest {
  content?: string;
  attemptId: string;
}

export interface TrialReelResult {
  ok: boolean;
  code: string;
  message: string;
  status: number;
}

export async function publishInstagramTrialReel(_req: TrialReelRequest): Promise<TrialReelResult> {
  // TODO(trial-reels): connect the Meta Trial Reel endpoint here once API
  // support + permissions are confirmed. Expected shape: create the Reel
  // container with the trial flag, then publish — return { ok: true } with
  // the resulting post id instead of the decline below.
  return {
    ok: false,
    code: 'INSTAGRAM_TRIAL_REEL_NOT_SUPPORTED',
    status: 400,
    message: 'Trial Reels are saved with the Trial flag, but Meta Trial Reel publishing is not connected yet. Turn the Trial option off to publish as a normal Reel, or keep it scheduled until Trial support is connected.',
  };
}
