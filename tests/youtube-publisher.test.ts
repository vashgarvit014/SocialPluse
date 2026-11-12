import test from 'node:test';
import assert from 'node:assert/strict';
import { aiMetadataPlan, youtubeRequirements } from '../apps/web/src/app/_shell/youtube-publisher';

const untouched = { title: false, description: false, tags: false };
const generated = { title: 'Launch film', caption: 'A description', hashtags: ['launch', 'product'] };

test('AI metadata fills empty fields without asking', () => {
  const { apply, clobbered } = aiMetadataPlan(generated, { title: '', description: '', tags: '' }, untouched);
  assert.deepEqual(apply, { title: 'Launch film', description: 'A description', tags: 'launch, product' });
  assert.deepEqual(clobbered, []);
});

test('an empty generated value never erases what the author wrote', () => {
  const { apply } = aiMetadataPlan({ title: '', caption: 'New body', hashtags: [] }, { title: 'My title', description: 'Mine', tags: 'mine' }, untouched);
  assert.equal(apply.title, undefined, 'no generated title means the typed title is left alone');
  assert.equal(apply.tags, undefined);
  assert.equal(apply.description, 'New body');
});

test('replacing edited fields is flagged for confirmation, untouched ones are not', () => {
  const { clobbered } = aiMetadataPlan(generated, { title: 'My own title', description: '', tags: 'launch, product' }, { title: true, description: false, tags: true });
  assert.deepEqual(clobbered, ['title'], 'only an edited field holding different text needs confirming');
});

const base = { connected: true, sourceSize: 1024, title: 'Launch', audience: 'general' as const, scheduleRequired: false, schedule: '' };
const ready = (o: Partial<typeof base> = {}) => youtubeRequirements({ ...base, ...o }).every((r) => r.ok);

test('readiness requires a channel, a video, a valid title and a declared audience', () => {
  assert.equal(ready(), true);
  assert.equal(ready({ connected: false }), false);
  assert.equal(ready({ sourceSize: 0 }), false, 'missing media must block upload');
  assert.equal(ready({ title: '   ' }), false);
  assert.equal(ready({ title: 'x'.repeat(101) }), false, 'mirrors the server YOUTUBE_TITLE_TOO_LONG rule');
  assert.equal(ready({ audience: '' }), false, 'audience must be declared, not defaulted');
});

test('choosing Schedule for Later blocks an immediate upload until a time is set', () => {
  assert.equal(ready({ scheduleRequired: true, schedule: '' }), false);
  assert.equal(ready({ scheduleRequired: true, schedule: '2030-01-01T10:00' }), true);
  const labels = youtubeRequirements({ ...base, scheduleRequired: true, schedule: '' }).filter((r) => !r.ok).map((r) => r.label);
  assert.match(labels.join(' '), /Schedule for Later/);
});

test('datetime-local bounds are formatted in local time, not UTC', async () => {
  const { localDateTimeValue } = await import('../apps/web/src/app/_shell/youtube-publisher');
  const at = Date.parse('2030-06-01T12:00:00Z');
  const produced = localDateTimeValue(at);
  const expected = new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  assert.equal(produced, expected);
  // Round-tripping through Date.parse (how the browser reads the field) must
  // land back on the same instant, which the old UTC formatting did not.
  assert.equal(Date.parse(produced), at);
});

test('a past or too-soon schedule blocks upload, matching the server five-minute rule', () => {
  const now = Date.parse('2030-01-01T00:00:00Z');
  const at = (offsetMs: number) => {
    const t = now + offsetMs;
    return new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const check = (schedule: string) => youtubeRequirements({ ...base, scheduleRequired: true, schedule, now }).every((r) => r.ok);
  assert.equal(check(at(-60 * 60_000)), false, 'a past time must not upload');
  assert.equal(check(at(60_000)), false, 'under five minutes is rejected by validateYouTubeMetadata');
  assert.equal(check(at(10 * 60_000)), true);
  assert.equal(check('not-a-date'), false);
});

test('non-JSON proxy responses never crash the upload or leak HTML', async () => {
  const { parseApiResponse } = await import('../apps/web/src/app/_shell/youtube-publisher');
  const nginx413 = '<html> <head><title>413 Request Entity Too Large</title></head> <body>…</body></html>';

  const ok = parseApiResponse(200, 'application/json', JSON.stringify({ upload: { id: 'u1' }, chunkSize: 8388608 }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data?.upload, { id: 'u1' });

  const tooLarge = parseApiResponse(413, 'text/html', nginx413);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.data, null);
  assert.match(tooLarge.message, /too large/i);
  assert.ok(!tooLarge.message.includes('<'), 'raw HTML must never reach the user');

  for (const [status, pattern] of [[404, /not found/i], [502, /unreachable/i], [503, /unavailable/i], [504, /timed out/i], [401, /sign in again/i]] as const) {
    const parsed = parseApiResponse(status, 'text/html', '<html> <h1>error</h1></html>');
    assert.equal(parsed.ok, false);
    assert.match(parsed.message, pattern);
    assert.ok(!parsed.message.includes('<'));
  }

  // A JSON content-type with a truncated body must not throw either.
  const broken = parseApiResponse(200, 'application/json', '{"upload":');
  assert.equal(broken.ok, false);
  assert.match(broken.message, /unexpected 200/i);

  // A 2xx carrying no upload is not proof the video was published.
  const empty = parseApiResponse(200, 'application/json', '{}');
  assert.equal(empty.data?.upload, undefined);
});
