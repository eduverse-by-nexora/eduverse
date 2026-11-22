const express = require("express");
const User = require("../models/User");
const config = require("../config");
const hub = require("../classroom/hub");
const rateLimit = require("../middleware/rateLimit");
const { signToken, newSessionId, requireAuth } = require("../middleware/auth");
const pw = require("../utils/password");
const { isRole, isUserId, clean, label } = require("../utils/validate");
const { sendResetCode } = require("../utils/mailer");

const router = express.Router();

const fail = (res, status, code, error, extra) => res.status(status).json({ error, code, ...(extra || {}) });
const bad = (res, msg, code) => fail(res, 400, code || "INVALID_INPUT", msg);

// Several layers: per IP here, per account (lockout) in the handlers.
const authLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 40 });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, key: (r) => r.ip + ":" + clean((r.body || {}).userId || (r.body || {}).username) });

// Reads role + id from the body (the old API used "username") and checks their shape.
function readIdentity(req, res) {
  const body = req.body || {};
  const role = body.role;
  const userId = clean(body.userId !== undefined ? body.userId : body.username);
  if (!isRole(role)) { bad(res, "Choose Student or Faculty."); return null; }
  if (!userId) { bad(res, `${label(role)} is required.`); return null; }
  if (!isUserId(userId)) { bad(res, `Enter a valid ${label(role)} (letters, digits, - and _ only).`); return null; }
  return { role, userId };
}

const findWithSecrets = (role, userId) => User.findOne({ role, userId }).select("+passwordHash +resetCodeHash");

async function startSession(user) {
  const sid = newSessionId();
  user.sessionId = sid;
  await user.save();
  hub.disconnectUser(String(user._id), "session-replaced"); // sign out the older session, if any
  return signToken(user, sid);
}

function lockedResponse(res, user) {
  const mins = Math.max(1, Math.ceil((user.lockUntil - Date.now()) / 60000));
  return fail(res, 423, "ACCOUNT_LOCKED", `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, { retryAfter: mins * 60 });
}

async function registerFailure(user) {
  user.failedLogins = (user.failedLogins || 0) + 1;
  if (user.failedLogins >= config.maxLoginFailures) {
    user.lockUntil = new Date(Date.now() + config.lockMs);
    user.failedLogins = 0;
  }
  await user.save();
}

// ---------- LOGIN ----------
async function login(req, res, next) {
  try {
    const ident = readIdentity(req, res);
    if (!ident) return;
    const password = (req.body || {}).password;
    if (typeof password !== "string" || !password) return bad(res, "Password is required.");
    if (password.length > 200) return fail(res, 401, "INVALID_CREDENTIALS", `Invalid ${label(ident.role)} or password.`);

    const user = await findWithSecrets(ident.role, ident.userId);
    if (!user) {
      await pw.burnTime(password); // same timing as a real check
      return fail(res, 401, "INVALID_CREDENTIALS", `Invalid ${label(ident.role)} or password.`);
    }
    if (user.lockUntil && user.lockUntil > Date.now()) return lockedResponse(res, user);
    if (!user.passwordHash) {
      return fail(res, 403, "PASSWORD_NOT_SET", "No password has been set for this ID yet. Use \"Set up your password\" first.");
    }
    if (!(await pw.verifyPassword(password, user.passwordHash))) {
      await registerFailure(user);
      if (user.lockUntil && user.lockUntil > Date.now()) return lockedResponse(res, user);
      return fail(res, 401, "INVALID_CREDENTIALS", `Invalid ${label(ident.role)} or password.`);
    }

    user.failedLogins = 0;
    user.lockUntil = null;
    const token = await startSession(user);
    // "id" / "name" / "role" / "room" keep the same shape the frontend always used
    res.json({ token, ...user.publicProfile(), user: user.publicProfile() });
  } catch (err) { next(err); }
}
router.post("/login", authLimiter, login);
router.post("/auth/login", authLimiter, login);

// ---------- FIRST-TIME PASSWORD SETUP ("signup") ----------
// Accounts are created by the administrator. The ID must already exist, and a password can only be
// set here while the account has none yet. Changing an existing password needs the old password
// (Change Password) or a verified one-time code (Forgot Password) - never just the ID.
router.post("/auth/signup", strictLimiter, async (req, res, next) => {
  try {
    const ident = readIdentity(req, res);
    if (!ident) return;
    const { password, confirmPassword } = req.body || {};
    const user = await findWithSecrets(ident.role, ident.userId);
    if (!user) {
      return fail(res, 404, "ID_NOT_REGISTERED",
        ident.role === "faculty"
          ? "This Faculty ID is not registered. Faculty IDs are issued by the administrator."
          : "This Student ID is not registered. Please contact your administrator.");
    }
    if (user.passwordHash) {
      return fail(res, 409, "PASSWORD_ALREADY_SET",
        "A password is already set for this ID. Log in, or use \"Forgot password\" if you cannot remember it.");
    }
    if (confirmPassword !== undefined && confirmPassword !== password) return bad(res, "The two passwords do not match.");
    const problem = pw.validatePassword(password, user.userId);
    if (problem) return bad(res, problem, "WEAK_PASSWORD");

    const hash = await pw.hashPassword(password);
    // the filter makes this atomic: if two requests race, only the first one wins
    const result = await User.updateOne(
      { _id: user._id, passwordHash: null },
      { $set: { passwordHash: hash, passwordSetAt: new Date(), passwordChangedAt: new Date(), failedLogins: 0, lockUntil: null } }
    );
    if (result.modifiedCount !== 1) return fail(res, 409, "PASSWORD_ALREADY_SET", "A password is already set for this ID.");
    res.status(201).json({ ok: true, message: "Password saved. You can log in now." });
  } catch (err) { next(err); }
});

// ---------- FORGOT PASSWORD: ask for a one-time code ----------
router.post("/auth/forgot", strictLimiter, async (req, res, next) => {
  try {
    const ident = readIdentity(req, res);
    if (!ident) return;
    const user = await findWithSecrets(ident.role, ident.userId);
    if (user) {
      const code = pw.newResetCode();
      user.resetCodeHash = pw.hashCode(code);
      user.resetExpiresAt = new Date(Date.now() + config.resetCodeTtlMs);
      user.resetAttempts = 0;
      await user.save();
      await sendResetCode(user, code);
    }
    // identical answer whether or not the ID exists
    res.json({
      ok: true,
      message: "If this ID is registered, a 6-digit reset code has been sent to its registered e-mail address. " +
               "If no e-mail is on file, ask your administrator for a reset code.",
    });
  } catch (err) { next(err); }
});

// ---------- RESET PASSWORD with the code ----------
router.post("/auth/reset", strictLimiter, async (req, res, next) => {
  try {
    const ident = readIdentity(req, res);
    if (!ident) return;
    const { code, newPassword, confirmPassword } = req.body || {};
    const invalid = () => fail(res, 400, "INVALID_CODE", "That code is wrong or has expired. Request a new one.");
    if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return invalid();

    const user = await findWithSecrets(ident.role, ident.userId);
    if (!user || !user.resetCodeHash || !user.resetExpiresAt || user.resetExpiresAt < Date.now()) return invalid();
    if (user.resetAttempts >= config.resetMaxAttempts) {
      user.resetCodeHash = null; user.resetExpiresAt = null; user.resetAttempts = 0;
      await user.save();
      return invalid();
    }
    if (!pw.codeMatches(code.trim(), user.resetCodeHash)) {
      user.resetAttempts += 1;
      await user.save();
      return invalid();
    }
    if (confirmPassword !== undefined && confirmPassword !== newPassword) return bad(res, "The two passwords do not match.");
    const problem = pw.validatePassword(newPassword, user.userId);
    if (problem) return bad(res, problem, "WEAK_PASSWORD"); // the code stays valid so the user can retry

    user.passwordHash = await pw.hashPassword(newPassword);
    user.passwordSetAt = user.passwordSetAt || new Date();
    user.passwordChangedAt = new Date();
    user.resetCodeHash = null; user.resetExpiresAt = null; user.resetAttempts = 0;
    user.failedLogins = 0; user.lockUntil = null;
    user.tokenVersion += 1; user.sessionId = null; // every old session stops working
    await user.save();
    hub.disconnectUser(String(user._id), "password-changed");
    res.json({ ok: true, message: "Password updated. Please log in with the new password." });
  } catch (err) { next(err); }
});

// ---------- CHANGE PASSWORD (logged in) ----------
router.post("/auth/change-password", requireAuth, rateLimit({ windowMs: 15 * 60 * 1000, max: 15, key: (r) => r.ip }), async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (typeof currentPassword !== "string" || !currentPassword) return bad(res, "Enter your current password.");
    const user = await findWithSecrets(req.user.role, req.user.userId);
    if (!user || !user.passwordHash) return fail(res, 401, "UNAUTHORIZED", "Please log in again.");
    if (user.lockUntil && user.lockUntil > Date.now()) return lockedResponse(res, user);
    if (!(await pw.verifyPassword(currentPassword, user.passwordHash))) {
      await registerFailure(user);
      return fail(res, 401, "INVALID_CREDENTIALS", "Your current password is not correct.");
    }
    if (confirmPassword !== undefined && confirmPassword !== newPassword) return bad(res, "The two new passwords do not match.");
    const problem = pw.validatePassword(newPassword, user.userId);
    if (problem) return bad(res, problem, "WEAK_PASSWORD");
    if (await pw.verifyPassword(newPassword, user.passwordHash)) return bad(res, "The new password must be different from the current one.", "SAME_PASSWORD");

    user.passwordHash = await pw.hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    user.failedLogins = 0;
    user.tokenVersion += 1; // signs out every other device / old token
    const sid = newSessionId();
    user.sessionId = sid;
    await user.save();
    // the current browser gets a fresh token; its open socket stays (it was already authenticated)
    res.json({ ok: true, message: "Password changed.", token: signToken(user, sid) });
  } catch (err) { next(err); }
});

// ---------- SESSION ----------
router.get("/me", requireAuth, (req, res) => {
  res.json({ ...req.user.publicProfile(), passwordSet: true });
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    req.user.sessionId = null;
    await req.user.save();
    hub.disconnectUser(String(req.user._id), "logout");
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ICE servers for WebRTC (voice + screen share). TURN credentials only go to logged-in users.
router.get("/rtc-config", requireAuth, (req, res) => {
  const iceServers = [{ urls: config.rtc.stun }];
  if (config.rtc.turnUrls.length) {
    iceServers.push({ urls: config.rtc.turnUrls, username: config.rtc.turnUsername, credential: config.rtc.turnCredential });
  }
  res.json({ iceServers });
});

module.exports = router;
