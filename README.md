# EduVerse - virtual campus with live classrooms

A game-style virtual campus. Students walk around a hall, enter a classroom, sit on a bench and talk to their teacher
in real time. Faculty get a live dashboard (who is seated where, who is standing, raised hands) and decide who may
share a screen.

**Stack:** Node.js · Express · **MongoDB** (Mongoose) · Socket.IO · WebRTC · plain HTML/CSS/JS (no build step)

---

## Quick start

```bash
npm install
cp .env.example .env        # set MONGODB_URI and JWT_SECRET (see the file)
npm run seed                # creates the 12 classrooms + the accounts from data.json (without passwords)
npm start                   # http://localhost:3000
```

You need a MongoDB server (local install, Docker `docker run -p 27017:27017 mongo`, or a free MongoDB Atlas URL in `MONGODB_URI`).

**First login:** nobody has a password yet. Open the site → **Set up your password** → choose Student/Faculty → enter the ID
from `data.json` (e.g. student `2510011214`, faculty `1516` = Logic Design, TCS-308) → pick a password → log in.

> The microphone and screen sharing only work on `https://` pages or `http://localhost`. To use the app from other
> computers, serve it over HTTPS (set `SSL_KEY_FILE` / `SSL_CERT_FILE`, or use a host that provides HTTPS).

---

## Accounts, passwords and the administrator

Users live in MongoDB (`users` collection). **`data.json` is only used once, by `npm run seed`.** The old plain-text
passwords in it were removed, and a duplicate Student ID (two accounts both named `2510011214`) was corrected to `2510011514`.

| Who | How an account is created |
|---|---|
| Student | The administrator adds the Student ID. The student then sets a password. |
| Faculty | The administrator adds a **special Faculty ID** (+ name + classroom). The teacher then sets a password. |

Administrator commands (this is how IDs get into MongoDB):

```bash
npm run admin -- add-student 2510019999 --name "Asha Rao" --email asha@school.edu
npm run admin -- add-faculty "F-7KQ2M9XA" --name "Dr. Iyer" --room TCS-331     # classroom must exist
npm run admin -- generate-faculty-id            # prints a random, hard-to-guess Faculty ID
npm run admin -- import-students students.csv   # lines: id[,name[,email]]
npm run admin -- list [student|faculty]
npm run admin -- reset-code student 2510019999  # one-time code for someone who forgot their password
npm run admin -- unlock faculty 1516            # clear a lockout
npm run admin -- remove student 2510019999
npm run admin -- rooms
```

### Login / sign-up / password rules

* **Login page first.** Pick Student or Faculty, enter the ID and password.
* **Set up your password (sign-up).** The ID **must already exist in MongoDB**. If it does not, the page says
  *"This Student ID is not registered"* (or Faculty ID) and **no account is created**. A password can be set this way
  **only while the account has no password yet.**
  *(Deliberate difference from "allow update": if anyone who knows an ID could overwrite an existing password, accounts
  could be hijacked. Existing passwords change only through Change Password or a verified reset.)*
* **Change password** (account menu, top right): needs the current password; signs out other sessions.
* **Forgot password:** enter the ID → a 6-digit code is e-mailed to the address on file (set `SMTP_*` in `.env`), **or** the
  administrator issues one (`reset-code`). The code is single-use, expires in 10 minutes and locks after 5 wrong tries.
  In development (no SMTP) the code is also printed in the server console.
* Passwords: 8-72 characters, at least one letter and one number, not a common password, not equal to the ID.
* Stored as **bcrypt** hashes only. 5 wrong passwords lock the account for 15 minutes; auth endpoints are rate limited;
  answers do not reveal whether an ID exists (except on the sign-up page, as requested); all input is type-checked (stops NoSQL injection).
* Sessions are signed JWTs (8 h). One active session per user; logout, a new login elsewhere, a password change or a reset
  invalidate older tokens. The browser keeps the token in `sessionStorage` (survives a refresh, not a closed tab).

---

## In the classroom

**Controls:** `W A S D` / arrows walk · `S` sit (next to a free bench) · `Ctrl` stand up · `H` raise/lower hand · `M` walking sound · `E` notice board · `+ − 0` / wheel zoom

* **Entering a room:** the camera frames the room and a student's avatar **walks by itself to the seating area** (pathfinding around
  benches). Press any move key to take over. Free seats glow green; walk next to one and press **S** (use `↓` to walk down
  near benches). Every room has 24 seats: 4 rows × 2 benches × 3 seats, a centre aisle and a teacher's desk.
* **Standing students** can walk and listen, but **microphone, screen sharing and Raise Hand are disabled** (and refused by the server).
* **Seated students** can use the microphone, Raise Hand, and *request* screen sharing. Standing up turns all of that off again.
* **Raise Hand:** the teacher instantly gets a notification and chime, the student's row moves to the top of the dashboard,
  and a hand shows above the avatar.

### Library (subject notes)
As in the project sketch, the campus building (hall + 12 classrooms) is unchanged, and the **library** is one tall room on its **left**, joined to the
hall's left end by a path (the hall's right end is closed). The library has **no seats**. Instead it has **12 subject sections**, one per subject: a
bookshelf with the subject code and a coloured floor area in front of it.

* **Notes panel:** as soon as a student walks in, a panel opens on the right listing every subject's PDF notes with **Open** and **Download** buttons.
  It can be closed with **×** and reopened with the **Notes** button in the bottom bar.
* **Sections:** stand at a subject's section and press **E** to jump to (and highlight) that subject's notes in the panel.
* **Quiet zone:** no microphone, no screen sharing (the server refuses them). **H** (*Ask librarian*) calls the librarian from anywhere inside, no seat needed.
* The room-entry `audio.mp3` also plays when a student enters the library.

**Adding the real notes:** the files in `public/notes/` (`TCS-308.pdf`, `TCS-302.pdf`, ...) are one-page **placeholders**. Replace a file with the real
PDF (same name), or edit `LibraryNotes` in `public/js/config.js` to list any number of files per subject (`{ title, file }`). Then run `npm run sync`
so the GitHub Pages copy (`notes/` in the project root) is updated too.

**Library administrator (librarian):** one account, created automatically on first start (`src/db.js`):

| Role | ID | Initial password |
|---|---|---|
| Librarian | `LIB001` | `Library@123` |

Log in with the **Librarian** tab. **Change the password straight away** (account menu → Change password), or set `LIBRARIAN_ID` / `LIBRARIAN_PASSWORD`
in `.env` before the first start. It is stored hashed like every other password; forgot-password works with `npm run admin -- reset-code librarian LIB001`.
The librarian starts at the desk in the library and walks the library and its path only. Their dashboard shows who is inside (and at which subject
section), who **needs help** (with a notification and chime) and a **Notes** tab with the same PDF list; they can mark help given or remove a student
from the library. An older database whose librarian still points at a removed library wing (`LIB-N` ...) is moved to the new library on start.

### Faculty dashboard (right-hand panel)
* Counters: present · seated · standing · hands · free seats.
* **Students** tab: *Hands raised* (oldest first) / *Seated* (with *Bench 3 · Seat B*) / *Standing* (marked *waiting for a seat* when all 24 seats are taken).
  Per student: mute/unmute, lower hand, allow/stop screen sharing, remove (two clicks).
* **Seat map** tab: the whole room - who sits where, hands, and the waiting queue. Click a seat to jump to that student.
* **Screen** tab: requests (Allow / Deny), current share, Stop.

### Voice
Real WebRTC audio (Opus, echo cancellation, noise suppression). The teacher is heard by everyone in the room; a seated student is heard by
the teacher and the other seated students. Muting, standing up, leaving the room or losing the connection stops a student's audio at once.
The server relays WebRTC signalling **only when the rules allow that connection**, so a standing or muted student can never be heard.
Broken connections are rebuilt automatically. The speaker button controls volume / mutes speakers.

### Classrooms
12 classrooms (6 on each side of the hall), one per subject, defined in `data.json` (and `MeetingSubjects` in `public/js/config.js`, same order):
TCS-308 Logic Design and Computer Organization · TCS-302 Data Structures with C · TCS-307 Object Oriented Programming with C++ ·
TMA-316 Discrete Structures and Combinatorics · TOC-301 Probability and Statistics (Audit) · XCS-301 Career Skills-I / PEPCC ·
UHV-301 UHV-II · TCS-351 Cloud Computing and Big Data · TCS-392 Introduction to Cryptography · TCS-331 IoT · TCS-340 Python Programming ·
TCS-332 Information Security and Blockchain. Door signs in the hall show each room's code (green dot = class is live).
Faculty `1516`-`1527` are assigned to them in that order. Rooms are re-synced from `data.json` every time the server starts.

**Room-entry sound:** `public/audio.mp3` plays once when a *student* walks into any classroom (never in the hall, no looping). Replace the file with your
own sound (keep the name `audio.mp3`, then `npm run sync`). The hall walking sound (`ding.mp3`) is unchanged.

### Screen sharing
* **Default: nobody may share.** A seated student requests → the teacher **Allows or Denies**. Permission covers one session; it ends when
  they stop, stand up or leave, or when the teacher takes it back.
* **Only one share at a time** per classroom; while one is active nobody else can start (enforced by the server).
* The shared screen appears **on the right of the faculty's screen** and in the same panel for every student in the room, live.
  The teacher can also present their own screen (when no student is sharing).
* **Sound:** the browser only shares sound if the sharer picks it: choose a **Chrome Tab** and tick *Also share tab audio*, or on Windows choose *Entire screen* and tick *Share system audio*
  (sharing a single window never includes sound). The sharer is told whether sound is included, viewers see *Sound on / No sound in this share*, follow the classroom volume,
  and get an *Enable sound* button if the browser blocks autoplay.
* **Viewers (everyone except the teacher and the sharer) are view-only:** no download, capture, picture-in-picture, fullscreen or playback controls;
  right-click / drag / copy / print / save shortcuts are blocked; the picture is **hidden when the window loses focus** (what snipping tools cause),
  while `PrintScreen` / Win+Shift+S / Cmd+Shift+3-5 are pressed, and when printing; the viewer's own ID is tiled over it as a watermark.

> **Honest limit:** a web page cannot stop the operating system or a phone camera from capturing the screen. The measures above remove every
> way to capture *through the classroom interface* and deter/trace the rest. Truly preventing capture needs DRM-style protection, which browsers do not offer for live screen shares.

---

## Strict networks (TURN)
STUN is built in and works on most networks. Behind strict firewalls voice/screen need a TURN server: set `TURN_URLS`, `TURN_USERNAME`,
`TURN_CREDENTIAL` in `.env` (credentials are only given to logged-in users).

## Project layout
```
server.js                 Express + Socket.IO + MongoDB entry point
src/config.js             environment settings
src/models/               User, Room (Mongoose)
src/routes/auth.js        login, sign-up, forgot/reset, change password, me, logout, rtc-config
src/middleware/           JWT auth, rate limiting, security headers + CORS
src/classroom/engine.js   realtime rules: seats, hands, mic, screen share, library quiet zone, WebRTC signalling
scripts/                  seed.js, admin.js, sync-root.js
public/                   the frontend (index.html, style.css, js/*.js) and notes/ (the library's PDF notes)
index.html, style.css, js/, notes/   copies of public/ for GitHub Pages  ->  run "npm run sync" after editing public/
tests/                    api.test.js (npm test) and e2e/ (browser tests)
cpp/, main.exe            untouched
```

## API
REST (JSON): `POST /api/auth/login` · `/signup` · `/forgot` · `/reset` · `/change-password` · `GET /api/me` · `POST /api/logout` · `GET /api/rtc-config`
(`POST /api/login` still works as an alias). Presence, seating and classroom control moved from HTTP polling to **Socket.IO** (`/socket.io`),
authenticated with the same token.

## Deploying with GitHub Pages
GitHub Pages hosts only the static frontend. Deploy the Node server (Render, Railway, ...) with MongoDB Atlas, set `API_BASE` in
`public/js/config.js`, add your Pages URL to `CORS_ORIGINS`, set `JWT_SECRET`, `NODE_ENV=production`, `TRUST_PROXY=true`, then run `npm run sync`.

## Testing
```bash
npm test      # 20 API tests against MongoDB database "eduverse_test" (auth, password rules, lockout, reset, injection)

# browser tests (real Chromium with a fake microphone: faculty + students, audio, screen share, rules):
npm i -D playwright && npx playwright install chromium
npm start     # in another terminal; passwords for the demo IDs must be set as used in tests/e2e/*.js
node tests/e2e/classroom.e2e.js
node tests/e2e/library.e2e.js     # library path, subject sections, notes panel + downloads, librarian, quiet zone
```

## Known limits
* Positions are reported by the browser (as before). Seat, hand, mic, screen and moderation rules are enforced by the server, but a modified client could
  claim to be next to a bench it is not near.
* Voice/screen use a peer-to-peer mesh: fine for a class of roughly 30. Larger classes need an SFU (LiveKit, mediasoup).
* Rate limiting is in memory (one server process).
