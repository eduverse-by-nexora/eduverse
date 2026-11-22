const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const User = require("../models/User");

// A token is valid only while the user's tokenVersion and sessionId still match.
//  - a new login replaces the old session (one active session per user)
//  - logout, password change and password reset invalidate every existing token
function signToken(user, sessionId) {
  return jwt.sign({ sub: String(user._id), sid: sessionId, v: user.tokenVersion }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.jwtTtl,
  });
}

const newSessionId = () => crypto.randomBytes(16).toString("hex");

// Returns the user document for a valid token, otherwise null.
async function userFromToken(token) {
  if (!token || typeof token !== "string") return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.sub !== "string" || !/^[a-f0-9]{24}$/.test(payload.sub)) return null;
  const user = await User.findById(payload.sub);
  if (!user || !user.sessionId || user.sessionId !== payload.sid || user.tokenVersion !== payload.v) return null;
  return user;
}

function tokenFromRequest(req) {
  const h = req.headers.authorization;
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7);
  return req.headers["x-token"];
}

async function requireAuth(req, res, next) {
  try {
    const user = await userFromToken(tokenFromRequest(req));
    if (!user) return res.status(401).json({ error: "Invalid or missing token", code: "UNAUTHORIZED" });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

const requireRole = (role) => (req, res, next) =>
  req.user && req.user.role === role ? next() : res.status(403).json({ error: "Not allowed", code: "FORBIDDEN" });

module.exports = { signToken, newSessionId, userFromToken, requireAuth, requireRole };
