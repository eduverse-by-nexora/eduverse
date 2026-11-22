// Central configuration. Everything comes from environment variables (see .env.example).
require("dotenv").config({ quiet: true });
const crypto = require("crypto");

const isProd = process.env.NODE_ENV === "production";
const list = (v, fallback) =>
  (v === undefined || v === "" ? fallback : v).split(",").map((s) => s.trim()).filter(Boolean);

let jwtSecret = process.env.JWT_SECRET;
let generatedSecret = false;
if (!jwtSecret) {
  if (isProd) {
    console.error("JWT_SECRET must be set when NODE_ENV=production.");
    process.exit(1);
  }
  // Development convenience: a random secret. Everybody is signed out when the server restarts.
  jwtSecret = crypto.randomBytes(48).toString("hex");
  generatedSecret = true;
}

module.exports = {
  isProd,
  generatedSecret,
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/eduverse",
  jwtSecret,
  jwtTtl: process.env.JWT_TTL || "8h",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  trustProxy: process.env.TRUST_PROXY || false,

  // Frontends allowed to call this API from another origin (e.g. GitHub Pages)
  corsOrigins: list(process.env.CORS_ORIGINS, "https://eduverse-by-nexora.github.io"),

  // Password reset / lockout
  resetCodeTtlMs: 10 * 60 * 1000,
  resetMaxAttempts: 5,
  maxLoginFailures: 5,
  lockMs: 15 * 60 * 1000,

  // Optional e-mail delivery for reset codes
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        from: process.env.SMTP_FROM || "EduVerse <no-reply@eduverse.local>",
      }
    : null,

  // WebRTC: STUN is enough on most networks, TURN is needed on strict school/company firewalls
  rtc: {
    stun: list(process.env.STUN_URLS, "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"),
    turnUrls: list(process.env.TURN_URLS, ""),
    turnUsername: process.env.TURN_USERNAME || "",
    turnCredential: process.env.TURN_CREDENTIAL || "",
  },

  // Optional HTTPS (needed for the microphone when opening the site from another computer)
  ssl: process.env.SSL_KEY_FILE && process.env.SSL_CERT_FILE
    ? { key: process.env.SSL_KEY_FILE, cert: process.env.SSL_CERT_FILE }
    : null,
};
