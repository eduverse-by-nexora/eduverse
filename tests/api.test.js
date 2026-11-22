// End-to-end tests for the MongoDB authentication system.
// Needs a MongoDB server (default mongodb://127.0.0.1:27017). Uses its own database "eduverse_test".
//   npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ENV = { ...process.env, PORT: String(PORT), MONGODB_URI: process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/eduverse_test", JWT_SECRET: "test-secret-test-secret-test-secret", BCRYPT_ROUNDS: "4" };
const ROOT = path.join(__dirname, "..");
let server, logs = "";

const call = async (method, url, body, token) => {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", ...(token ? { "x-token": token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {};
  try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, ...json, body: json };
};
const post = (u, b, t) => call("POST", u, b, t);
const admin = (...a) => execFileSync("node", ["scripts/admin.js", ...a], { cwd: ROOT, env: ENV }).toString();

before(async () => {
  execFileSync("node", ["scripts/seed.js", "--reset"], { cwd: ROOT, env: ENV });
  server = spawn("node", ["server.js"], { cwd: ROOT, env: ENV });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + "/api/me"); return; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error("server did not start:\n" + logs);
});
after(() => server && server.kill());

test("student that is not registered cannot create an account", async () => {
  const r = await post("/api/auth/signup", { role: "student", userId: "9999999999", password: "Str0ngPass1" });
  assert.equal(r.status, 404);
  assert.equal(r.code, "ID_NOT_REGISTERED");
  assert.match(r.error, /not registered/i);
  const l = await post("/api/auth/login", { role: "student", userId: "9999999999", password: "Str0ngPass1" });
  assert.equal(l.status, 401);
});

test("unregistered faculty ID is rejected", async () => {
  const r = await post("/api/auth/signup", { role: "faculty", userId: "FAKE-ID-1", password: "Str0ngPass1" });
  assert.equal(r.status, 404);
  assert.equal(r.code, "ID_NOT_REGISTERED");
});

test("an ID is checked per role (a student cannot claim a faculty ID)", async () => {
  const r = await post("/api/auth/signup", { role: "student", userId: "1516", password: "Str0ngPass1" });
  assert.equal(r.status, 404);
});

test("login before a password exists tells the user to set one up", async () => {
  const r = await post("/api/auth/login", { role: "student", userId: "2510011214", password: "whatever1" });
  assert.equal(r.status, 403);
  assert.equal(r.code, "PASSWORD_NOT_SET");
});

test("password policy is enforced on setup", async () => {
  for (const bad of ["short1", "onlyletters", "12345678", "password1", "2510011214"]) {
    const r = await post("/api/auth/signup", { role: "student", userId: "2510011214", password: bad });
    assert.equal(r.status, 400, bad);
  }
  const mismatch = await post("/api/auth/signup", { role: "student", userId: "2510011214", password: "Str0ngPass1", confirmPassword: "Different1" });
  assert.equal(mismatch.status, 400);
});

test("registered student sets a password, then logs in", async () => {
  const s = await post("/api/auth/signup", { role: "student", userId: "2510011214", password: "Str0ngPass1" });
  assert.equal(s.status, 201);
  const l = await post("/api/auth/login", { role: "student", userId: "2510011214", password: "Str0ngPass1" });
  assert.equal(l.status, 200);
  assert.equal(l.role, "student");
  assert.ok(l.token && l.token.split(".").length === 3);
  const me = await call("GET", "/api/me", null, l.token);
  assert.equal(me.status, 200);
  assert.equal(me.userId, "2510011214");
});

test("signup cannot overwrite an existing password (account takeover protection)", async () => {
  const r = await post("/api/auth/signup", { role: "student", userId: "2510011214", password: "Hacker1234" });
  assert.equal(r.status, 409);
  assert.equal(r.code, "PASSWORD_ALREADY_SET");
  const l = await post("/api/auth/login", { role: "student", userId: "2510011214", password: "Hacker1234" });
  assert.equal(l.status, 401);
});

test("passwords are stored hashed, never as plain text", async () => {
  const out = execFileSync("node", ["-e", `
    const m=require('mongoose');const U=require('./src/models/User');
    m.connect(process.env.MONGODB_URI).then(async()=>{const u=await U.findOne({userId:'2510011214'}).select('+passwordHash').lean();console.log(u.passwordHash);await m.disconnect();});`],
    { cwd: ROOT, env: ENV }).toString().trim();
  assert.match(out, /^\$2[aby]\$\d\d\$/);
  assert.ok(!out.includes("Str0ngPass1"));
});

test("faculty with a pre-registered special ID sets a password and gets their room", async () => {
  const s = await post("/api/auth/signup", { role: "faculty", userId: "1516", password: "Teach3rPass" });
  assert.equal(s.status, 201);
  const l = await post("/api/auth/login", { role: "faculty", userId: "1516", password: "Teach3rPass" });
  assert.equal(l.status, 200);
  assert.equal(l.room, "TCS-308");
  assert.equal(l.name, "Dr. Sharma");
});

test("administrator can add a new special faculty ID which then works", async () => {
  const id = admin("generate-faculty-id").trim();
  assert.match(id, /^F-[A-Z2-9]{8}$/);
  admin("add-faculty", id, "--name", "Dr. New", "--room", "TCS-302");
  const s = await post("/api/auth/signup", { role: "faculty", userId: id, password: "Fresh1Pass" });
  assert.equal(s.status, 201);
  const l = await post("/api/auth/login", { role: "faculty", userId: id, password: "Fresh1Pass" });
  assert.equal(l.status, 200);
  assert.equal(l.room, "TCS-302");
});

test("role mismatch and NoSQL-injection payloads are rejected", async () => {
  const wrongRole = await post("/api/auth/login", { role: "faculty", userId: "2510011214", password: "Str0ngPass1" });
  assert.equal(wrongRole.status, 401);
  const inj = await post("/api/auth/login", { role: "student", userId: { $ne: null }, password: { $ne: null } });
  assert.equal(inj.status, 400);
  const inj2 = await post("/api/auth/login", { role: { $ne: "x" }, userId: "2510011214", password: "x" });
  assert.equal(inj2.status, 400);
  const inj3 = await post("/api/auth/signup", { role: "student", userId: { $gt: "" }, password: "Str0ngPass1" });
  assert.equal(inj3.status, 400);
});

test("protected routes need a valid token", async () => {
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("GET", "/api/me", null, "garbage")).status, 401);
  assert.equal((await post("/api/auth/change-password", { currentPassword: "a", newPassword: "b" })).status, 401);
  assert.equal((await call("GET", "/api/rtc-config")).status, 401);
});

test("change password: needs the current password, invalidates old tokens", async () => {
  const l = await post("/api/auth/login", { role: "student", userId: "2510011514", password: "x" }); // not set yet
  assert.equal(l.status, 403);
  await post("/api/auth/signup", { role: "student", userId: "2510011514", password: "Orig1nalPass" });
  const login = await post("/api/auth/login", { role: "student", userId: "2510011514", password: "Orig1nalPass" });
  const wrong = await post("/api/auth/change-password", { currentPassword: "nope-nope1", newPassword: "N3wPassword" }, login.token);
  assert.equal(wrong.status, 401);
  const same = await post("/api/auth/change-password", { currentPassword: "Orig1nalPass", newPassword: "Orig1nalPass" }, login.token);
  assert.equal(same.status, 400);
  const weak = await post("/api/auth/change-password", { currentPassword: "Orig1nalPass", newPassword: "weak" }, login.token);
  assert.equal(weak.status, 400);
  const ok = await post("/api/auth/change-password", { currentPassword: "Orig1nalPass", newPassword: "N3wPassword" }, login.token);
  assert.equal(ok.status, 200);
  assert.ok(ok.token);
  assert.equal((await call("GET", "/api/me", null, login.token)).status, 401, "old token must stop working");
  assert.equal((await call("GET", "/api/me", null, ok.token)).status, 200, "new token works");
  assert.equal((await post("/api/auth/login", { role: "student", userId: "2510011514", password: "Orig1nalPass" })).status, 401);
  assert.equal((await post("/api/auth/login", { role: "student", userId: "2510011514", password: "N3wPassword" })).status, 200);
});

test("a new login signs the older session out (one session per user)", async () => {
  const a = await post("/api/auth/login", { role: "student", userId: "2510011214", password: "Str0ngPass1" });
  const b = await post("/api/auth/login", { role: "student", userId: "2510011214", password: "Str0ngPass1" });
  assert.equal((await call("GET", "/api/me", null, a.token)).status, 401);
  assert.equal((await call("GET", "/api/me", null, b.token)).status, 200);
  assert.equal((await post("/api/logout", {}, b.token)).status, 200);
  assert.equal((await call("GET", "/api/me", null, b.token)).status, 401);
});

test("forgot / reset password with a one-time code", async () => {
  // same answer for known and unknown IDs (no account enumeration)
  const known = await post("/api/auth/forgot", { role: "student", userId: "2510011592" });
  const unknown = await post("/api/auth/forgot", { role: "student", userId: "7777777777" });
  assert.equal(known.status, 200);
  assert.equal(known.message, unknown.message);

  await post("/api/auth/signup", { role: "student", userId: "2510011592", password: "Before1Reset" });
  const code = admin("reset-code", "student", "2510011592").match(/: (\d{6})/)[1];

  assert.equal((await post("/api/auth/reset", { role: "student", userId: "2510011592", code: "000000", newPassword: "After1Reset" })).status, 400);
  const weak = await post("/api/auth/reset", { role: "student", userId: "2510011592", code, newPassword: "weak" });
  assert.equal(weak.status, 400);
  assert.equal(weak.code, "WEAK_PASSWORD", "a weak password does not burn the code");
  const ok = await post("/api/auth/reset", { role: "student", userId: "2510011592", code, newPassword: "After1Reset" });
  assert.equal(ok.status, 200);
  assert.equal((await post("/api/auth/reset", { role: "student", userId: "2510011592", code, newPassword: "Another1Pass" })).status, 400, "code is single use");
  assert.equal((await post("/api/auth/login", { role: "student", userId: "2510011592", password: "Before1Reset" })).status, 401);
  assert.equal((await post("/api/auth/login", { role: "student", userId: "2510011592", password: "After1Reset" })).status, 200);
});

test("reset code is locked after too many wrong guesses", async () => {
  await post("/api/auth/signup", { role: "student", userId: "2510012706", password: "Guess1Guess" });
  const code = admin("reset-code", "student", "2510012706").match(/: (\d{6})/)[1];
  const wrong = code === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) await post("/api/auth/reset", { role: "student", userId: "2510012706", code: wrong, newPassword: "Brute1Force" });
  const r = await post("/api/auth/reset", { role: "student", userId: "2510012706", code, newPassword: "Brute1Force" });
  assert.equal(r.status, 400, "the right code no longer works after 5 failures");
});

test("account locks after repeated wrong passwords", async () => {
  await post("/api/auth/signup", { role: "faculty", userId: "1517", password: "Lock1Me1234" });
  let last;
  for (let i = 0; i < 5; i++) last = await post("/api/auth/login", { role: "faculty", userId: "1517", password: "wrong-pass1" });
  assert.equal(last.status, 423);
  const right = await post("/api/auth/login", { role: "faculty", userId: "1517", password: "Lock1Me1234" });
  assert.equal(right.status, 423, "even the right password is refused while locked");
  admin("unlock", "faculty", "1517");
  assert.equal((await post("/api/auth/login", { role: "faculty", userId: "1517", password: "Lock1Me1234" })).status, 200);
});

test("security headers and API hygiene", async () => {
  const res = await fetch(BASE + "/api/me");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("content-security-policy").includes("default-src 'self'"));
  assert.equal(res.headers.get("x-powered-by"), null);
  const big = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "student", userId: "x".repeat(20000) }) });
  assert.equal(big.status, 413);
  const badJson = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
  assert.equal(badJson.status, 400);
});

test("library administrator account exists, uses the same secure login and cannot be claimed via sign-up", async () => {
  const wrongRole = await post("/api/auth/login", { role: "student", userId: "LIB001", password: "Library@123" });
  assert.equal(wrongRole.status, 401, "the librarian ID is not a student ID");
  const wrong = await post("/api/auth/login", { role: "librarian", userId: "LIB001", password: "not-the-password1" });
  assert.equal(wrong.status, 401);
  const ok = await post("/api/auth/login", { role: "librarian", userId: "LIB001", password: "Library@123" });
  assert.equal(ok.status, 200);
  assert.equal(ok.role, "librarian");
  assert.equal(ok.room, "LIBRARY");
  const takeover = await post("/api/auth/signup", { role: "librarian", userId: "LIB001", password: "Hacker1234" });
  assert.equal(takeover.status, 409, "an existing password cannot be overwritten through sign-up");
  const change = await post("/api/auth/change-password", { currentPassword: "Library@123", newPassword: "Lib#Admin2026" }, ok.token);
  assert.equal(change.status, 200);
  assert.equal((await post("/api/auth/login", { role: "librarian", userId: "LIB001", password: "Library@123" })).status, 401);
  assert.equal((await post("/api/auth/login", { role: "librarian", userId: "LIB001", password: "Lib#Admin2026" })).status, 200);
  const code = admin("reset-code", "librarian", "LIB001").match(/: (\d{6})/)[1];
  assert.equal((await post("/api/auth/reset", { role: "librarian", userId: "LIB001", code, newPassword: "Back#To2026x" })).status, 200);
});

test("rooms by data: 12 classrooms + one library without seats (the old wings are removed)", () => {
  const out = execFileSync("node", ["scripts/admin.js", "rooms"], { cwd: ROOT, env: ENV }).toString();
  for (const c of ["TCS-308", "XCS-301", "TCS-332", "LIBRARY"]) assert.match(out, new RegExp(c));
  for (const c of ["LIB-N", "LIB-W", "LIB-E", "LIB-S"]) assert.doesNotMatch(out, new RegExp(c));
  assert.equal(out.trim().split("\n").length, 13);
  const lib = require("../data.json").rooms.find((r) => r.type === "library");
  assert.equal(lib.seats, 0);
});
