// EduVerse backend: Node.js + Express 4
// Serves the frontend and handles login with token sessions.

const express = require("express");
const crypto = require("crypto");
const data = require("./data.json");

const app = express();
// Allow the GitHub Pages frontend (a different origin) to call this API
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://eduverse-by-nexora.github.io");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static("public"));

// token -> username (only one active token per user)
const sessions = {};

// POST /api/login
app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body || {};
  const user = data.users.find(
    (u) => u.username === username && u.password === password
  );
  // the login form sends which tab (student/faculty) was used; it must match
  if (!user || (role && user.role !== role)) {
    return res.status(401).json({ error: "Wrong username or password" });
  }

  // remove the older session of this user
  for (const t in sessions) {
    if (sessions[t] === user.username) delete sessions[t];
  }

  const token = crypto.randomBytes(16).toString("hex");
  sessions[token] = user.username;

  // students start in the hall; a faculty member starts inside their assigned room (user.room = subject code)
  res.json({
    token: token,
    id: user.id || user.username,
    name: user.name,
    role: user.role,
    room: user.room,
  });
});

// Checks the x-token header. Missing or wrong token -> 401.
function checkToken(req, res, next) {
  const username = sessions[req.headers["x-token"]];
  if (!username) {
    return res.status(401).json({ error: "Invalid or missing token" });
  }
  req.user = data.users.find((u) => u.username === username);
  next();
}

// GET /api/me 
app.get("/api/me", checkToken, (req, res) => {
  const u = req.user;
  res.json({ name: u.name, role: u.role, room: u.room });
});

// Who is on the campus map right now. Only logged-in users are listed,
// and a user disappears if they stop reporting for a few seconds.
const presence = {};
const PRESENCE_TTL = 4000;

// POST /api/presence  (protected) body: { x, y, room }
// x, y = position on the campus map (world units, rooms included), room = subject code or null
// -> the other users on campus + how many are online
app.post("/api/presence", checkToken, (req, res) => {
  const body = req.body || {};
  const coord = (n) => (typeof n === "number" && isFinite(n) ? Math.min(5000, Math.max(0, n)) : 0);
  let room = typeof body.room === "string" && body.room.length <= 12 ? body.room : null;
  const now = Date.now();
  const me = req.user;
  // a faculty member always belongs to their assigned room
  if (me.role === "faculty" && me.room) room = me.room;
  presence[me.username] = {
    id: me.id || me.username,
    name: me.name,
    role: me.role,
    x: coord(body.x),
    y: coord(body.y),
    room: room,
    seen: now,
  };

  const players = [];
  for (const name in presence) {
    if (now - presence[name].seen > PRESENCE_TTL) {
      delete presence[name];
    } else if (name !== me.username) {
      const p = presence[name];
      players.push({ id: p.id, name: p.name, role: p.role, x: p.x, y: p.y, room: p.room });
    }
  }
  res.json({ players: players, online: players.length + 1 });
});

// POST /api/presence/leave  (protected)
app.post("/api/presence/leave", checkToken, (req, res) => {
  delete presence[req.user.username];
  res.json({ ok: true });
});

// POST /api/logout  (protected)
app.post("/api/logout", checkToken, (req, res) => {
  delete presence[req.user.username];
  delete sessions[req.headers["x-token"]];
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app
  .listen(PORT, () => console.log("EduVerse running at http://localhost:" + PORT))
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log("Port " + PORT + " is already in use - an older EduVerse server is probably still running.");
      console.log("Close it (Ctrl+C in its terminal), or start on another port.");
    } else {
      console.log(err.message);
    }
    process.exit(1);
  });