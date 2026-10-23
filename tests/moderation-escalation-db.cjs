// Run with: DATABASE_URL=... node --test tests/moderation-escalation-db.cjs
// Content Violation Monitoring — real-Postgres checks for escalation tiers,
// idempotent incident recording, and the false-positive dismissal path.
// Follows tests/scheduled-publish.cjs's real-DB convention: skips cleanly
// when DATABASE_URL is unreachable.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const url = (p) => pathToFileURL(path.join(root, p)).href;

test('user-service moderation store: escalation tiers, idempotency, and false-positive dismissal', async (t) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { t.skip('DATABASE_URL not set'); return; }
  let Pool;
  try { ({ Pool } = require('pg')); } catch { t.skip('pg not installed in this context'); return; }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 4000 });
  try { await pool.query('SELECT 1'); } catch { await pool.end().catch(() => {}); t.skip('database unreachable from this context'); return; }

  const { createModerationStore, FLAG_THRESHOLD } = await import(url('services/user-service/src/moderation.mjs'));
  const store = createModerationStore(pool);

  const suffix = require('node:crypto').randomBytes(6).toString('hex');
  const userId = `00000000-0000-4000-8004-${suffix}`;

  try {
    await pool.query(`INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, 'x', now(), now())`, [userId, 'Moderation Test', `mod-${suffix}@example.test`]);

    assert.equal(FLAG_THRESHOLD, 3, 'spec: 3rd confirmed violation flags the account for review');

    const blockResult = { decision: 'BLOCK_NUDITY', method: 'LOCAL_REGEX', countsAsViolation: true, confidence: 0.9 };

    // 1st violation — warning + block, not yet flagged.
    const o1 = await store.recordModerationDecision(blockResult, {
      userId, action: 'BLOCKED_BEFORE_PUBLISH', source: 'DIRECT_PUBLISH', platform: 'instagram',
      idempotencyKey: `${userId}:1:${suffix}`,
    });
    assert.equal(o1.count, 1);
    assert.equal(o1.flagged, false);
    assert.ok(o1.incidentId, 'incident recorded');

    // Retry of the SAME idempotency key must be a TRUE no-op — no second
    // incident, no counter movement, no second notification. The dedup
    // check runs before anything else is touched in the transaction.
    const o1retry = await store.recordModerationDecision(blockResult, {
      userId, action: 'BLOCKED_BEFORE_PUBLISH', source: 'DIRECT_PUBLISH', platform: 'instagram',
      idempotencyKey: `${userId}:1:${suffix}`,
    });
    assert.equal(o1retry.deduped, true);
    assert.equal(o1retry.incidentId, o1.incidentId, 'retry reports the SAME incident id, not a new one');
    assert.equal(o1retry.count, 1, 'violation counter does not move on a deduped retry');

    // 2nd violation (fresh idempotency key) — stronger warning, still not flagged.
    const o2 = await store.recordModerationDecision(blockResult, {
      userId, action: 'BLOCKED_BEFORE_PUBLISH', source: 'DIRECT_PUBLISH', platform: 'instagram',
      idempotencyKey: `${userId}:2:${suffix}`,
    });
    assert.equal(o2.count, 2);
    assert.equal(o2.flagged, false);

    // 3rd violation — crosses FLAG_THRESHOLD, account flagged for review.
    const o3 = await store.recordModerationDecision(blockResult, {
      userId, action: 'BLOCKED_BEFORE_PUBLISH', source: 'DIRECT_PUBLISH', platform: 'instagram',
      idempotencyKey: `${userId}:3:${suffix}`,
    });
    assert.equal(o3.count, 3);
    assert.equal(o3.flagged, true, '3rd confirmed violation must flag the account for Super Admin review');
    assert.equal(o3.newlyFlagged, true);

    // Dismiss the 3rd incident as a false positive — must decrement the
    // counter and leave the earlier two intact.
    const dismissResult = await store.applyIncidentAction(o3.incidentId, userId, 'dismiss-false-positive', 'reviewed, not actually a violation');
    assert.ok(dismissResult.success);
    const summaryAfter = await store.getUserModerationSummary(userId);
    assert.equal(summaryAfter.violationCount, 2, 'dismissing a false positive decrements the counter');

    const incidentAfter = await store.getIncidentById(o3.incidentId);
    assert.equal(incidentAfter.status, 'DISMISSED_FALSE_POSITIVE');
    assert.equal(incidentAfter.review_note, 'reviewed, not actually a violation');

    // UNCERTAIN never counts as a violation or flags the account.
    const uncertainResult = { decision: 'NEEDS_CLARIFICATION', method: 'LOCAL_REGEX', countsAsViolation: false, confidence: 0.5 };
    const o4 = await store.recordModerationDecision(uncertainResult, {
      userId, action: 'BLOCKED_BEFORE_PUBLISH', source: 'DIRECT_PUBLISH', platform: 'instagram',
      idempotencyKey: `${userId}:uncertain:${suffix}`,
    });
    assert.equal(o4.count, 2, 'UNCERTAIN does not increment the violation counter');
    const incident4 = await store.getIncidentById(o4.incidentId);
    assert.equal(incident4.status, 'UNCERTAIN');
  } finally {
    await pool.query('DELETE FROM moderation_incidents WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM moderation_events WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end().catch(() => {});
  }
});
