const mongoose = require("mongoose");

// One document per student or faculty member.
// Student / faculty accounts are created by the administrator (see scripts/admin.js and scripts/seed.js);
// the person then sets their own password. The password is only ever stored as a bcrypt hash.
const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true }, // Student ID or the special Faculty ID
    role: { type: String, enum: ["student", "faculty", "librarian"], required: true },
    name: { type: String, required: true, trim: true },
    room: { type: String, default: null }, // faculty: the classroom they teach in. librarian: the library
    email: { type: String, default: null, trim: true, lowercase: true }, // optional, used for reset codes

    passwordHash: { type: String, default: null, select: false },
    passwordSetAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },

    // Session management: a JWT is only valid while its version and session id match these values.
    tokenVersion: { type: Number, default: 0 },
    sessionId: { type: String, default: null },

    // Brute-force protection
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },

    // One-time reset code (stored hashed, expires quickly, limited attempts)
    resetCodeHash: { type: String, default: null, select: false },
    resetExpiresAt: { type: Date, default: null },
    resetAttempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// A Student ID and a Faculty ID may look alike, so uniqueness is per role.
userSchema.index({ role: 1, userId: 1 }, { unique: true });

userSchema.methods.publicProfile = function () {
  return {
    id: String(this._id),
    userId: this.userId,
    name: this.name,
    role: this.role,
    room: this.room || null,
  };
};

module.exports = mongoose.model("User", userSchema);
