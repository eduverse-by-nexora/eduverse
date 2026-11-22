const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const config = require("../config");

const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "iloveyou1", "admin123", "welcome1", "letmein123", "abc12345", "eduverse1", "eduverse123",
]);

// Returns an error message, or null when the password is acceptable.
function validatePassword(pw, userId) {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (Buffer.byteLength(pw, "utf8") > 72) return "Password is too long (maximum 72 bytes).";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain at least one letter and one number.";
  if (COMMON.has(pw.toLowerCase())) return "That password is too common. Choose a less predictable one.";
  if (userId && pw.toLowerCase() === String(userId).toLowerCase()) return "Password must not be the same as your ID.";
  return null;
}

const hashPassword = (pw) => bcrypt.hash(pw, config.bcryptRounds);
const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

// Used when the account does not exist, so a login attempt takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", config.bcryptRounds);
const burnTime = (pw) => bcrypt.compare(String(pw || ""), DUMMY_HASH);

// ----- one-time reset codes -----
const newResetCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
// stored as "salt:sha256(salt+code)"; independent of any server secret, so the admin CLI and the server always agree
const digest = (salt, code) => crypto.createHash("sha256").update(salt + String(code)).digest("hex");
const hashCode = (code) => { const salt = crypto.randomBytes(16).toString("hex"); return salt + ":" + digest(salt, code); };
function codeMatches(code, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(digest(salt, code), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { validatePassword, hashPassword, verifyPassword, burnTime, newResetCode, hashCode, codeMatches };
