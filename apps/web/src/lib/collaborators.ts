import type { Collaborator, CollabStatus } from './posts';

export const MAX_COLLABORATORS = 3;

export function addCollaborator(list: Collaborator[]): Collaborator[] {
  if (list.length >= MAX_COLLABORATORS) return list;
  return [...list, { username: '', type: 'professional', status: 'Not Requested' }];
}

export function removeCollaborator(list: Collaborator[], index: number): Collaborator[] {
  return list.filter((_, i) => i !== index);
}

export function updateCollaboratorField(list: Collaborator[], index: number, patch: Partial<Collaborator>): Collaborator[] {
  return list.map((c, i) => (i === index ? { ...c, ...patch } : c));
}

function setStatus(list: Collaborator[], index: number, status: CollabStatus): Collaborator[] {
  const now = new Date().toISOString();
  return list.map((c, i) => (i === index ? { ...c, status, lastUpdatedAt: now } : c));
}

// Private-type manual flow only: user confirms they sent the in-app invite.
export function markCollaboratorSent(list: Collaborator[], index: number): Collaborator[] {
  return setStatus(list, index, 'Manual Action Required');
}

export function markCollaboratorPending(list: Collaborator[], index: number): Collaborator[] {
  return setStatus(list, index, 'Pending Acceptance');
}

// Explicit, self-reported outcome — never inferred from an API response.
export function markCollaboratorResolved(list: Collaborator[], index: number, outcome: 'Accepted' | 'Declined'): Collaborator[] {
  return setStatus(list, index, outcome);
}

// Merges a publish response's per-collaborator results (from
// publishing-service, via /instagram or /instagram-trial) into current state.
// Professional entries get the real outcome; private entries only move to
// 'Ready' on success — failures never touch a private entry's status, since
// private collaborators were never sent to Graph in the first place.
export function mergeCollaboratorResults(list: Collaborator[], results: Array<{ username: string; type: string; status: CollabStatus }> | undefined): Collaborator[] {
  if (!results || !results.length) return list;
  const now = new Date().toISOString();
  const byUsername = new Map(results.map((r) => [r.username, r]));
  return list.map((c) => {
    const r = byUsername.get(c.username);
    return r ? { ...c, status: r.status, lastUpdatedAt: now } : c;
  });
}

// Strips UI-only fields before sending to the publish API — the backend only
// needs username + type.
export function collaboratorsForPublish(list: Collaborator[]): Array<{ username: string; type: 'professional' | 'private' }> | undefined {
  const cleaned = list.map((c) => ({ username: c.username.trim().replace(/^@+/, ''), type: c.type })).filter((c) => c.username);
  return cleaned.length ? cleaned : undefined;
}
