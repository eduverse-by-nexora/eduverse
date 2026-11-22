// EduVerse backend: Node.js + Express 4 + MongoDB (Mongoose) + Socket.IO
//  - REST API for login, password setup / change / reset and sessions (JWT)
//  - Socket.IO for the live campus: positions, classroom seating, raise hand, microphone,
//    screen-share permissions and the WebRTC signalling that carries voice and shared screens
//  - serves the frontend from /public

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const express = require("express");
const { Server } = require("socket.io");

const config = require("./src/config");
const db = require("./src/db");
const Room = require("./src/models/Room");
const security = require("./src/middleware/security");
const hub = require("./src/classroom/hub");
const { ClassroomEngine } = require("./src/classroom/engine");

async function main() {
  if (config.generatedSecret) console.warn("[config] JWT_SECRET not set - using a random one for this run (everybody is signed out when the server restarts).");
  await db.connect();
  const rooms = await Room.find().lean();

  const app = express();
  if (config.trustProxy) app.set("trust proxy", config.trustProxy === "true" ? 1 : config.trustProxy);
  app.disable("x-powered-by");
  app.use(security.headers);
  app.use(security.cors);
  app.use(express.json({ limit: "10kb" }));
  app.use("/api", require("./src/routes/auth"));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
  app.use(express.static(path.join(__dirname, "public")));

  // JSON errors for the API, never a stack trace
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request too large" });
    console.error("[error]", err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  const server = config.ssl
    ? https.createServer({ key: fs.readFileSync(config.ssl.key), cert: fs.readFileSync(config.ssl.cert) }, app)
    : http.createServer(app);

  const io = new Server(server, {
    cors: { origin: config.corsOrigins, methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e5,
    pingInterval: 5000,
    pingTimeout: 8000,
  });
  hub.engine = new ClassroomEngine(io, rooms);

  server.listen(config.port, () => {
    console.log(`EduVerse running at ${config.ssl ? "https" : "http"}://localhost:${config.port}`);
    console.log(`Database: MongoDB (${rooms.length} classrooms)`);
  }).on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log("Port " + config.port + " is already in use - an older EduVerse server is probably still running.");
      console.log("Close it (Ctrl+C in its terminal), or start on another port (PORT=3001 npm start).");
    } else {
      console.log(err.message);
    }
    process.exit(1);
  });

  const shutdown = () => { server.close(); require("mongoose").disconnect().finally(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
