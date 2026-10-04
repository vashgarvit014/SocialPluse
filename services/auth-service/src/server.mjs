import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT } from 'jose';
import { Pool, types } from 'pg';
import { createLogger } from '../packages/logger/index.mjs';
import { parseCookies } from '../packages/cookies/index.mjs';
import { createUsersRepo, normalizeEmail } from './users.mjs';
import { createUserSessionsRepo } from './user-sessions.mjs';
import { createOtpStore } from './otp.mjs';
import { createSessionManager, SESSION_COOKIE } from './session.mjs';
import { setPendingAuth, getPendingAuth, clearPendingAuth, PENDING_AUTH_COOKIE } from './pending-auth.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { createAuditLogger, clientIp } from './audit.mjs';
import { createDal } from './dal.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import { deliverOtp } from './delivery/index.mjs';
import { sendPasswordChangedEmail } from './delivery/email.mjs';
import { isValidEmailFormat } from './format-rules.mjs';
import { isValidMobile, normalizeMobile, maskEmail, maskMobile } from './mobile.mjs';
import { normalizeHost, isPublicHost, SUPERADMIN_ORIGIN } from './admin-host.mjs';
import {
  signupSchema, loginSchema, otpRequestSchema, otpVerifySchema, otpResendSchema,
  forgotPasswordSchema, resetPasswordSchema, passwordSchema, emailSchema,
} from './schemas.mjs';
import { z } from 'zod';

// auth-service — THE LAST MAJOR EXTRACTION. Owns everything that was
// src/lib/auth/** plus src/app/api/auth/**, src/app/api/superadmin/auth/**,
// and src/app/api/superadmin/settings/{password,email/*}: signup, login,
// logout, session issue/verify/revoke, OTP (all 5 purposes), password
// hashing/reset/change, Superadmin email change, role enforcement, secure
// cookies. Faithfully ported — no auth semantics were weakened; see
// MIGRATION-NOTES.md Phase 9 for the line-by-line audit this was built from.
//
// NOT ported here (deliberately, per the brief's own boundary + prior
// precedent): createAdminManagedUser (dead code, zero real callers),
// listUsers/setUserStatus/moderation (user-service's domain, Phase 8),
// the Superadmin "Auth Activity" / "Active Sessions" READ pages and the
// session-TERMINATE route (still monolith-only SSR/API, same "not every
// admin action moves this round" precedent as Phase 8's create-user/
// retry-publish).

const PORT = Number(process.env.PORT || 4011);
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const log = createLogger('auth-service');

types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));
types.setTypeParser(types.builtins.TIMESTAMP, (v) => (v === null ? null : new Date(v).toISOString()));

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => log.error({ event: 'pool_error', message: err.message }));
  return pool;
}
const poolProxy = { query: (...a) => getPool().query(...a) };

const usersRepo = createUsersRepo(poolProxy);
const userSessionsRepo = createUserSessionsRepo(poolProxy);
const otpStore = createOtpStore(poolProxy);
const sessionManager = createSessionManager(userSessionsRepo);
const rateLimiter = createRateLimiter(poolProxy);
const logAuthEvent = createAuditLogger(poolProxy);
const dal = createDal({ sessionManager, usersRepo, userSessionsRepo });

function verifyInternalSecretHeader(req) {
  const provided = req.headers['x-internal-secret'];
  if (typeof provided !== 'string' || !provided || !INTERNAL_SECRET) return false;
  const bufA = Buffer.from(provided);
  const bufB = Buffer.from(INTERNAL_SECRET);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}
function setCookieHeader(res, cookieString) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', [cookieString]);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, cookieString]);
  else res.setHeader('Set-Cookie', [existing, cookieString]);
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}
function validationErrorResponse(res, zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in fields)) fields[key] = issue.message;
  }
  return send(res, 400, { error: 'VALIDATION_ERROR', fields });
}

// Resolves the caller's verified session from the forwarded Cookie header.
// Used by every one of this service's OWN session-gated routes (/me,
// /logout, /superadmin/settings/*) — NOT by other services, which use
// /internal/verify-session via the gateway instead.
async function requireSession(req, res) {
  const session = await dal.verifySessionFromCookieHeader(req.headers.cookie);
  if (!session) {
    send(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return session;
}
async function requireSuperadmin(req, res) {
  const session = await requireSession(req, res);
  if (!session) return null;
  if (session.user.role !== 'SUPERADMIN') {
    send(res, 403, { error: 'Forbidden' });
    return null;
  }
  return session;
}

// --- Lightweight signed internal identity assertion (additive, see
// MIGRATION-NOTES.md Phase 9 "Internal identity assertion" section for
// what this does and does NOT cover yet — no downstream service verifies
// it yet; the existing x-actor-user-id/x-actor-role + internal-secret trust
// model remains the enforced mechanism meanwhile). ---
async function signIdentityAssertion({ userId, role, accountStatus, sessionId }) {
  return new SignJWT({ userId, role, accountStatus, sessionId: sessionId ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(new TextEncoder().encode(INTERNAL_SECRET));
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    log.info({ requestId, path: req.url, method: req.method, status: res.statusCode, durationMs: Date.now() - start });
  });

  try {
    const url = new URL(req.url, 'http://internal');

    if (url.pathname === '/health') {
      const config = {
        sessionSecret: !!process.env.SESSION_SECRET,
        otpHashSecret: !!process.env.OTP_HASH_SECRET,
      };
      try {
        await getPool().query('SELECT 1');
        return send(res, 200, { service: 'auth-service', status: 'ok', timestamp: new Date().toISOString(), config });
      } catch {
        return send(res, 503, { service: 'auth-service', status: 'degraded', timestamp: new Date().toISOString(), config });
      }
    }

    // --- internal, gateway-only: session verification for every OTHER
    // service's proxied request. Guarded by INTERNAL_SERVICE_SECRET so only
    // the gateway (not the public internet) can reach this. ---
    if (url.pathname === '/internal/verify-session' && req.method === 'GET') {
      if (!verifyInternalSecretHeader(req)) return send(res, 401, { authenticated: false, error: 'INTERNAL_UNAUTHORIZED' });
      const session = await dal.verifySessionFromCookieHeader(req.headers.cookie);
      if (!session) return send(res, 200, { authenticated: false });
      const identityAssertion = await signIdentityAssertion({
        userId: session.userId, role: session.user.role, accountStatus: session.user.status, sessionId: session.sessionId,
      });
      return send(res, 200, {
        authenticated: true, userId: session.userId, role: session.user.role,
        accountStatus: session.user.status, sessionId: session.sessionId, identityAssertion,
      });
    }

    // Phase 12 — Superadmin "Terminate session" action, moved out of the
    // monolith's src/app/api/superadmin/sessions/[id]/route.ts (which
    // called user-sessions.ts#revokeSession directly). admin-service
    // proxies here rather than writing to `user_sessions` itself — reads
    // for reporting stay in admin-service, writes to auth-owned tables
    // stay in auth-service.
    if (url.pathname.match(/^\/internal\/sessions\/[^/]+\/revoke$/) && req.method === 'POST') {
      if (!verifyInternalSecretHeader(req)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
      const sessionId = url.pathname.split('/')[3];
      await userSessionsRepo.revokeSession(sessionId);
      return send(res, 200, { success: true });
    }

    if (url.pathname.match(/^\/internal\/users\/[^/]+\/reset-access$/) && req.method === 'POST') {
      if (!verifyInternalSecretHeader(req)) return send(res, 401, { code: 'INTERNAL_UNAUTHORIZED', message: 'Missing or invalid internal service secret.' });
      const userId = url.pathname.split('/')[3];
      const body = await readJsonBody(req);
      const user = await usersRepo.findUserById(userId);
      if (!user) return send(res, 404, { error: 'User not found.' });
      if (user.status === 'SUSPENDED') {
        return send(res, 400, { error: 'This account is suspended. Reactivate it before resetting access.' });
      }
      const channel = user.email ? 'EMAIL' : 'WHATSAPP';
      const destination = user.email || user.mobile;
      if (!destination) return send(res, 400, { error: 'This account has no email or mobile on file.' });

      const { otp } = await otpStore.createChallenge({ userId: user.id, channel, destination, purpose: 'PASSWORD_RESET' });
      const delivery = await deliverOtp({ channel, destination, otp, purpose: 'PASSWORD_RESET', isSuperadmin: user.role === 'SUPERADMIN' });
      if (!delivery.ok) {
        logAuthEvent('OTP_DELIVERY_FAILED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip: clientIp(req) });
        return send(res, 502, { error: 'Could not send the verification code. Please try again shortly.' });
      }
      logAuthEvent('RESET_ACCESS_TRIGGERED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip: clientIp(req), meta: { actorUserId: body?.actorUserId || null } });
      return send(res, 200, {
        success: true,
        message: 'A verification code has been sent to the user. They can complete the reset from the login page (Forgot Password).',
        maskedDestination: channel === 'EMAIL' ? maskEmail(destination) : maskMobile(destination),
      });
    }

    const ip = clientIp(req);

    // ============================= SIGNUP =============================
    if (url.pathname === '/signup' && req.method === 'POST') {
      if (!(await rateLimiter.checkRateLimit(`signup:ip:${ip}`, 10, 3600))) {
        return send(res, 429, { error: 'Too many signup attempts. Please try again later.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = signupSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { name, email, mobile, password } = parsed.data;

      if (await usersRepo.findUserByEmail(email)) return send(res, 409, { error: 'An account with this email already exists.' });
      if (await usersRepo.findUserByMobile(mobile)) return send(res, 409, { error: 'An account with this mobile number already exists.' });

      let user;
      try {
        user = await usersRepo.createPendingUser(name, email, mobile, hashPassword(password));
      } catch (error) {
        if (error && typeof error === 'object' && error.code === '23505') {
          const detail = typeof error.detail === 'string' ? error.detail : '';
          const field = detail.includes('email') ? 'email' : detail.includes('mobile') ? 'mobile number' : 'email or mobile number';
          return send(res, 409, { error: `An account with this ${field} already exists.` });
        }
        throw error;
      }
      logAuthEvent('SIGNUP_SUCCESS', { userId: user.id, ip });
      const cookie = await setPendingAuth({ userId: user.id, purpose: 'SIGNUP_VERIFY' });
      setCookieHeader(res, cookie);
      return send(res, 200, { success: true, purpose: 'SIGNUP_VERIFY', channels: { email: maskEmail(user.email), whatsapp: maskMobile(user.mobile) } });
    }

    // ============================== LOGIN ==============================
    if (url.pathname === '/login' && req.method === 'POST') {
      const GENERIC_ERROR = 'Invalid email/mobile or password.';
      if (!(await rateLimiter.checkRateLimit(`login:ip:${ip}`, 20, 3600))) {
        return send(res, 429, { error: 'Too many login attempts. Please try again later.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { identifier, password } = parsed.data;

      if (!(await rateLimiter.checkRateLimit(`login:identifier:${identifier.toLowerCase()}`, 10, 3600))) {
        return send(res, 429, { error: 'Too many login attempts. Please try again later.' });
      }
      const user = await usersRepo.findUserByIdentifier(identifier);
      if (!user || !verifyPassword(password, user.passwordHash) || user.status === 'SUSPENDED') {
        logAuthEvent('LOGIN_FAILED', { ip, meta: { identifierType: identifier.includes('@') ? 'email' : 'mobile' } });
        return send(res, 401, { error: GENERIC_ERROR });
      }
      const purpose = user.status === 'PENDING' ? 'SIGNUP_VERIFY' : 'LOGIN_VERIFY';
      const cookie = await setPendingAuth({ userId: user.id, purpose });
      setCookieHeader(res, cookie);
      return send(res, 200, { success: true, purpose, channels: { email: maskEmail(user.email), whatsapp: user.mobile ? maskMobile(user.mobile) : null } });
    }

    // ============================= LOGOUT ==============================
    if (url.pathname === '/logout' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      const cookieString = await sessionManager.deleteSession(cookies[SESSION_COOKIE]);
      setCookieHeader(res, cookieString);
      return send(res, 200, { success: true });
    }

    // =============================== ME =================================
    if (url.pathname === '/me' && req.method === 'GET') {
      const session = await dal.verifySessionFromCookieHeader(req.headers.cookie);
      if (!session) return send(res, 401, { user: null });
      const { user } = session;
      return send(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } });
    }

    // =========================== OTP REQUEST ============================
    if (url.pathname === '/otp/request' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      const pending = await getPendingAuth(cookies[PENDING_AUTH_COOKIE]);
      if (!pending) return send(res, 401, { error: 'Your verification session has expired. Please start again.' });

      if (!(await rateLimiter.checkRateLimit(`otp_request:ip:${ip}`, 20, 3600)) || !(await rateLimiter.checkRateLimit(`otp_request:user:${pending.userId}`, 10, 3600))) {
        return send(res, 429, { error: 'Too many verification code requests. Please try again later.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = otpRequestSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { channel } = parsed.data;

      const user = await usersRepo.findUserById(pending.userId);
      if (!user) return send(res, 401, { error: 'Your verification session has expired. Please start again.' });

      const destination = channel === 'EMAIL' ? user.email : user.mobile;
      if (!destination) return send(res, 400, { error: 'WhatsApp is not available for this account — no mobile number on file. Please use Email.' });
      const destinationValid = channel === 'EMAIL' ? isValidEmailFormat(destination) : isValidMobile(destination);
      if (!destinationValid) return send(res, 400, { error: 'This account has no valid destination on file for that channel. Please contact support.' });

      const { challenge, otp } = await otpStore.createChallenge({ userId: user.id, channel, destination, purpose: pending.purpose });
      const delivery = await deliverOtp({ channel, destination, otp, purpose: pending.purpose, isSuperadmin: user.role === 'SUPERADMIN' });
      if (!delivery.ok) {
        logAuthEvent('OTP_DELIVERY_FAILED', { userId: user.id, channel, purpose: pending.purpose, ip });
        return send(res, 502, { error: delivery.error });
      }
      logAuthEvent('OTP_REQUESTED', { userId: user.id, channel, purpose: pending.purpose, ip });
      return send(res, 200, { challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, resendAvailableAt: challenge.resendAvailableAt });
    }

    // =========================== OTP VERIFY =============================
    if (url.pathname === '/otp/verify' && req.method === 'POST') {
      const GENERIC_INVALID = 'This code is invalid or has expired. Please request a new one.';
      const REASON_MESSAGE = {
        not_found: GENERIC_INVALID, invalid: GENERIC_INVALID, expired: GENERIC_INVALID,
        incorrect: 'Incorrect code. Please try again.', too_many_attempts: 'Too many verification attempts. Please request a new code.',
      };
      const cookies = parseCookies(req.headers.cookie);
      const pending = await getPendingAuth(cookies[PENDING_AUTH_COOKIE]);
      if (!pending) return send(res, 401, { error: 'Your verification session has expired. Please start again.' });

      if (!(await rateLimiter.checkRateLimit(`otp_verify:ip:${ip}`, 30, 3600))) {
        return send(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = otpVerifySchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { challengeId, otp } = parsed.data;

      if (!(await rateLimiter.checkRateLimit(`otp_verify:challenge:${challengeId}`, 10, 300))) {
        return send(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const owner = await otpStore.getChallengeOwner(challengeId);
      if (!owner || owner.userId !== pending.userId || owner.purpose !== pending.purpose) {
        return send(res, 400, { error: GENERIC_INVALID });
      }
      const result = await otpStore.verifyChallenge(challengeId, otp);
      if (!result.ok) {
        logAuthEvent('OTP_FAILED', { userId: pending.userId, purpose: pending.purpose, ip, meta: { reason: result.reason } });
        return send(res, 400, { error: REASON_MESSAGE[result.reason] });
      }
      logAuthEvent('OTP_VERIFIED', { userId: result.userId, channel: result.channel, purpose: result.purpose, ip });

      if (result.purpose === 'PASSWORD_RESET') {
        await usersRepo.markChannelVerified(result.userId, result.channel);
        const cookie = await setPendingAuth({ userId: result.userId, purpose: 'PASSWORD_RESET', verified: true });
        setCookieHeader(res, cookie);
        return send(res, 200, { success: true, canResetPassword: true });
      }

      // SIGNUP_VERIFY or LOGIN_VERIFY: this is the one point where a real
      // session gets created.
      await usersRepo.markChannelVerified(result.userId, result.channel);
      const user = await usersRepo.findUserById(result.userId);
      if (!user) return send(res, 400, { error: GENERIC_INVALID });

      const { cookieString } = await sessionManager.createSession(user.id, user.sessionVersion, { userAgent: req.headers['user-agent'], ip });
      setCookieHeader(res, cookieString);
      setCookieHeader(res, clearPendingAuth());
      await usersRepo.recordLogin(user.id);
      logAuthEvent('LOGIN_SUCCESS', { userId: user.id, ip, purpose: result.purpose });

      const host = normalizeHost(req.headers.host);
      const redirect = user.role !== 'SUPERADMIN' ? '/dashboard' : isPublicHost(host) ? `${SUPERADMIN_ORIGIN}/superadmin` : '/superadmin';
      return send(res, 200, { success: true, redirect });
    }

    // =========================== OTP RESEND =============================
    if (url.pathname === '/otp/resend' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      const pending = await getPendingAuth(cookies[PENDING_AUTH_COOKIE]);
      if (!pending) return send(res, 401, { error: 'Your verification session has expired. Please start again.' });

      const IP_LIMIT_WINDOW = 3600, USER_LIMIT_WINDOW = 3600;
      const ipAllowed = await rateLimiter.checkRateLimit(`otp_resend:ip:${ip}`, 20, IP_LIMIT_WINDOW);
      const userAllowed = ipAllowed ? await rateLimiter.checkRateLimit(`otp_resend:user:${pending.userId}`, 10, USER_LIMIT_WINDOW) : false;
      if (!ipAllowed || !userAllowed) {
        const retryAfterMs = await rateLimiter.rateLimitRetryMs(
          ipAllowed ? `otp_resend:user:${pending.userId}` : `otp_resend:ip:${ip}`,
          ipAllowed ? USER_LIMIT_WINDOW : IP_LIMIT_WINDOW,
        );
        return send(res, 429, { error: 'Too many resend requests. Please try again later.', retryAfterMs });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = otpResendSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { challengeId } = parsed.data;

      const owner = await otpStore.getChallengeOwner(challengeId);
      if (!owner || owner.userId !== pending.userId || owner.purpose !== pending.purpose) {
        return send(res, 400, { error: 'This code is invalid or has expired. Please request a new one.' });
      }
      const result = await otpStore.resendChallenge(challengeId);
      if (!result.ok) {
        if (result.reason === 'cooldown') return send(res, 429, { error: 'Please wait before requesting another code.', retryAfterMs: result.retryAfterMs });
        if (result.reason === 'limit') return send(res, 429, { error: 'Maximum resend attempts reached. Please start again.' });
        return send(res, 400, { error: 'This code is invalid or has expired. Please request a new one.' });
      }
      const requester = await usersRepo.findUserById(pending.userId);
      const delivery = await deliverOtp({ channel: result.channel, destination: result.destination, otp: result.otp, purpose: result.purpose, isSuperadmin: requester?.role === 'SUPERADMIN' });
      if (!delivery.ok) {
        logAuthEvent('OTP_DELIVERY_FAILED', { userId: pending.userId, channel: result.channel, purpose: result.purpose, ip });
        return send(res, 502, { error: delivery.error });
      }
      logAuthEvent('OTP_REQUESTED', { userId: pending.userId, channel: result.channel, purpose: result.purpose, ip, meta: { resend: true } });
      return send(res, 200, { success: true, resendAvailableAt: result.resendAvailableAt, expiresAt: result.expiresAt });
    }

    // ========================= PASSWORD FORGOT ==========================
    if (url.pathname === '/password/forgot' && req.method === 'POST') {
      const GENERIC_MESSAGE = 'If an account exists for the provided details, a verification code has been sent.';
      const dummy = () => send(res, 200, { message: GENERIC_MESSAGE, challengeId: randomUUID(), resendAvailableAt: new Date(Date.now() + 60_000).toISOString() });

      const body = await readJsonBody(req);
      if (body === undefined) return dummy();
      const parsed = forgotPasswordSchema.safeParse(body);
      if (!parsed.success) return dummy();
      const { identifier } = parsed.data;

      if (!(await rateLimiter.checkRateLimit(`password_forgot:ip:${ip}`, 10, 3600)) || !(await rateLimiter.checkRateLimit(`password_forgot:identifier:${identifier.toLowerCase()}`, 5, 3600))) {
        return dummy();
      }
      const isEmail = identifier.includes('@');
      const channel = isEmail ? 'EMAIL' : 'WHATSAPP';
      if (!isEmail && !isValidMobile(identifier)) return dummy();

      const user = await usersRepo.findUserByIdentifier(identifier);
      if (!user || user.status === 'SUSPENDED') return dummy();

      const destination = isEmail ? user.email : user.mobile;
      if (!destination) return dummy();

      const { challenge, otp } = await otpStore.createChallenge({ userId: user.id, channel, destination, purpose: 'PASSWORD_RESET' });
      const delivery = await deliverOtp({ channel, destination, otp, purpose: 'PASSWORD_RESET', isSuperadmin: user.role === 'SUPERADMIN' });
      if (!delivery.ok) {
        logAuthEvent('OTP_DELIVERY_FAILED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip });
        return dummy();
      }
      const cookie = await setPendingAuth({ userId: user.id, purpose: 'PASSWORD_RESET' });
      setCookieHeader(res, cookie);
      logAuthEvent('OTP_REQUESTED', { userId: user.id, channel, purpose: 'PASSWORD_RESET', ip });
      return send(res, 200, {
        message: GENERIC_MESSAGE, challengeId: challenge.challengeId,
        maskedDestination: isEmail ? maskEmail(destination) : maskMobile(destination),
        resendAvailableAt: challenge.resendAvailableAt, expiresAt: challenge.expiresAt,
      });
    }

    // ========================= PASSWORD RESET ===========================
    if (url.pathname === '/password/reset' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      const pending = await getPendingAuth(cookies[PENDING_AUTH_COOKIE]);
      if (!pending || pending.purpose !== 'PASSWORD_RESET' || !pending.verified) {
        return send(res, 401, { error: 'Verification required before resetting your password.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = resetPasswordSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { newPassword } = parsed.data;

      await usersRepo.updatePassword(pending.userId, hashPassword(newPassword));
      setCookieHeader(res, clearPendingAuth());
      logAuthEvent('PASSWORD_RESET', { userId: pending.userId, ip });
      return send(res, 200, { success: true });
    }

    // ======================= SUPERADMIN LOGIN ============================
    if (url.pathname === '/superadmin/login' && req.method === 'POST') {
      const GENERIC_ERROR = 'Invalid email/mobile or password.';
      if (!(await rateLimiter.checkRateLimit(`slogin:ip:${ip}`, 20, 3600))) {
        return send(res, 429, { error: 'Too many login attempts. Please try again later.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { identifier, password } = parsed.data;

      if (!(await rateLimiter.checkRateLimit(`slogin:identifier:${identifier.toLowerCase()}`, 10, 3600))) {
        return send(res, 429, { error: 'Too many login attempts. Please try again later.' });
      }
      const user = await usersRepo.findUserByIdentifier(identifier);
      if (!user || !verifyPassword(password, user.passwordHash) || user.status === 'SUSPENDED' || user.role !== 'SUPERADMIN') {
        logAuthEvent('LOGIN_FAILED', { ip, meta: { interface: 'superadmin', identifierType: identifier.includes('@') ? 'email' : 'mobile' } });
        return send(res, 401, { error: GENERIC_ERROR });
      }
      const purpose = user.status === 'PENDING' ? 'SIGNUP_VERIFY' : 'LOGIN_VERIFY';
      const cookie = await setPendingAuth({ userId: user.id, purpose });
      setCookieHeader(res, cookie);
      logAuthEvent('LOGIN_SUCCESS', { userId: user.id, ip, purpose, meta: { interface: 'superadmin' } });
      return send(res, 200, { success: true, purpose, channels: { email: maskEmail(user.email), whatsapp: user.mobile ? maskMobile(user.mobile) : null } });
    }

    // ======================= SUPERADMIN CHECK ============================
    if (url.pathname === '/superadmin/check' && req.method === 'GET') {
      const session = await requireSuperadmin(req, res);
      if (!session) return;
      const { user } = session;
      return send(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }

    // =================== SUPERADMIN SETTINGS: PASSWORD ===================
    if (url.pathname === '/superadmin/settings/password' && req.method === 'POST') {
      const session = await requireSuperadmin(req, res);
      if (!session) return;
      const changePasswordSchema = z.object({
        currentPassword: z.string().min(1, 'Current password is required.'),
        newPassword: passwordSchema,
        confirmPassword: z.string().min(1, 'Please confirm the new password.'),
      });
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = changePasswordSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { currentPassword, newPassword, confirmPassword } = parsed.data;

      const full = await usersRepo.findUserByEmail(session.user.email);
      if (!full) return send(res, 404, { error: 'Account not found.' });
      if (!verifyPassword(currentPassword, full.passwordHash)) return send(res, 400, { error: 'Current password is incorrect.' });
      if (newPassword !== confirmPassword) return send(res, 400, { error: 'New password and confirmation do not match.' });
      if (verifyPassword(newPassword, full.passwordHash)) return send(res, 400, { error: 'New password must be different from your current password.' });

      await usersRepo.updatePassword(session.userId, hashPassword(newPassword));
      const updated = await usersRepo.findUserById(session.userId);
      if (updated) {
        const { cookieString } = await sessionManager.createSession(updated.id, updated.sessionVersion, { userAgent: req.headers['user-agent'], ip });
        setCookieHeader(res, cookieString);
      }
      const notification = await sendPasswordChangedEmail({ to: full.email, changedAt: new Date(), ip, userAgent: req.headers['user-agent'] });
      if (!notification.ok) log.warn({ event: 'password_changed_email_failed', error: notification.error });
      logAuthEvent('SUPERADMIN_PASSWORD_CHANGED', { userId: session.userId, ip, meta: { notified: notification.ok } });
      return send(res, 200, { success: true, notified: notification.ok });
    }

    // ================ SUPERADMIN SETTINGS: EMAIL REQUEST ==================
    if (url.pathname === '/superadmin/settings/email/request' && req.method === 'POST') {
      const session = await requireSuperadmin(req, res);
      if (!session) return;
      if (!(await rateLimiter.checkRateLimit(`semail:req:${session.userId}`, 5, 3600))) {
        return send(res, 429, { error: 'Too many email-change attempts. Please try again later.' });
      }
      const requestSchema = z.object({ newEmail: emailSchema });
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) return send(res, 400, { error: 'Please enter a valid email address.' });
      const next = normalizeEmail(parsed.data.newEmail);
      if (next === normalizeEmail(session.user.email)) return send(res, 400, { error: 'Please enter a different email address.' });
      if (await usersRepo.findUserByEmail(next)) return send(res, 409, { error: 'This email address is already in use.' });

      const { challenge, otp } = await otpStore.createChallenge({ userId: session.userId, channel: 'EMAIL', destination: next, purpose: 'EMAIL_CHANGE' });
      logAuthEvent('SUPERADMIN_EMAIL_CHANGE_REQUESTED', { userId: session.userId, ip });
      const delivery = await deliverOtp({ channel: 'EMAIL', destination: next, otp, purpose: 'EMAIL_CHANGE' });
      if (!delivery.ok) return send(res, 502, { error: delivery.error });
      logAuthEvent('SUPERADMIN_EMAIL_CHANGE_OTP_SENT', { userId: session.userId, ip });
      return send(res, 200, { challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, resendAvailableAt: challenge.resendAvailableAt });
    }

    // ================= SUPERADMIN SETTINGS: EMAIL VERIFY ==================
    if (url.pathname === '/superadmin/settings/email/verify' && req.method === 'POST') {
      const GENERIC_INVALID = 'This code is invalid or has expired. Please request a new one.';
      const session = await requireSuperadmin(req, res);
      if (!session) return;
      if (!(await rateLimiter.checkRateLimit(`semail:verify:${session.userId}`, 10, 3600))) {
        return send(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = otpVerifySchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);
      const { challengeId, otp } = parsed.data;

      const owner = await otpStore.getChallengeOwner(challengeId);
      if (!owner || owner.userId !== session.userId || owner.purpose !== 'EMAIL_CHANGE') return send(res, 400, { error: GENERIC_INVALID });

      const result = await otpStore.verifyChallenge(challengeId, otp);
      if (!result.ok) {
        const message = result.reason === 'incorrect' ? 'Incorrect code. Please try again.' : result.reason === 'too_many_attempts' ? 'Too many verification attempts. Please request a new code.' : GENERIC_INVALID;
        logAuthEvent('SUPERADMIN_EMAIL_CHANGE_FAILED', { userId: session.userId, ip, meta: { reason: result.reason } });
        return send(res, 400, { error: message });
      }
      const next = normalizeEmail(result.destination);
      if (next === normalizeEmail(session.user.email)) return send(res, 400, { error: 'Please enter a different email address.' });
      const taken = await usersRepo.findUserByEmail(next);
      if (taken && taken.id !== session.userId) return send(res, 409, { error: 'This email address is already in use.' });

      try {
        await usersRepo.updateUserEmail(session.userId, next);
      } catch (error) {
        if (error && typeof error === 'object' && error.code === '23505') return send(res, 409, { error: 'This email address is already in use.' });
        throw error;
      }
      logAuthEvent('SUPERADMIN_EMAIL_CHANGED', { userId: session.userId, ip });
      return send(res, 200, { success: true, email: next });
    }

    // ================= SUPERADMIN SETTINGS: EMAIL RESEND ==================
    if (url.pathname === '/superadmin/settings/email/resend' && req.method === 'POST') {
      const session = await requireSuperadmin(req, res);
      if (!session) return;
      if (!(await rateLimiter.checkRateLimit(`semail:resend:${session.userId}`, 10, 3600))) {
        return send(res, 429, { error: 'Too many resend requests. Please try again later.' });
      }
      const body = await readJsonBody(req);
      if (body === undefined) return send(res, 400, { error: 'Invalid request.' });
      const parsed = otpResendSchema.safeParse(body);
      if (!parsed.success) return validationErrorResponse(res, parsed.error);

      const owner = await otpStore.getChallengeOwner(parsed.data.challengeId);
      if (!owner || owner.userId !== session.userId || owner.purpose !== 'EMAIL_CHANGE') {
        return send(res, 400, { error: 'This code is invalid or has expired. Please request a new one.' });
      }
      const result = await otpStore.resendChallenge(parsed.data.challengeId);
      if (!result.ok) {
        if (result.reason === 'cooldown') return send(res, 429, { error: 'Please wait before requesting another code.', retryAfterMs: result.retryAfterMs });
        if (result.reason === 'limit') return send(res, 429, { error: 'Maximum resend attempts reached. Please start again.' });
        return send(res, 400, { error: 'This code is invalid or has expired. Please request a new one.' });
      }
      const delivery = await deliverOtp({ channel: result.channel, destination: result.destination, otp: result.otp, purpose: result.purpose });
      if (!delivery.ok) return send(res, 502, { error: delivery.error });
      logAuthEvent('SUPERADMIN_EMAIL_CHANGE_OTP_SENT', { userId: session.userId, ip, meta: { resend: true } });
      return send(res, 200, { success: true, resendAvailableAt: result.resendAvailableAt });
    }

    return send(res, 404, { code: 'NOT_FOUND', message: 'No such auth-service route.' });
  } catch (err) {
    log.error({ requestId, event: 'request_failed', message: err instanceof Error ? err.message : 'unknown' });
    if (!res.headersSent) return send(res, 500, { code: 'AUTH_SERVICE_ERROR', message: 'Internal error.' });
  }
});

server.listen(PORT, () => log.info({ event: 'listening', port: PORT }));

function shutdown(signal) {
  log.info({ event: 'shutdown_start', signal });
  server.close(() => {
    (pool ? pool.end() : Promise.resolve()).finally(() => {
      log.info({ event: 'shutdown_complete' });
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('unhandledRejection', (reason) => {
  log.error({ event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
