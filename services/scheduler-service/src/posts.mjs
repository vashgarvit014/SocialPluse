// Faithful port of src/lib/posts.ts's state-transition helpers.
export function cancelPost(post, now = new Date().toISOString()) {
  if (!['pending', 'scheduled', 'cancelled'].includes(post.status)) throw new Error('This post cannot be cancelled. It may already be publishing.');
  return { ...post, status: 'draft', scheduledAt: null, cancelledAt: now, updatedAt: now, source: 'Schedule Cancelled', previousScheduledAt: post.scheduledAt || post.previousScheduledAt || null };
}
export function reschedulePost(post, scheduledAt, now = new Date().toISOString()) {
  if (post.status !== 'pending') throw new Error('This post cannot be rescheduled. It may already be publishing.');
  return { ...post, scheduledAt, updatedAt: now };
}
