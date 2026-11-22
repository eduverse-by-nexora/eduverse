// Backend URL. GitHub Pages only hosts static files, so when the site is opened
// from github.io the API calls must go to the deployed Node server instead.
// Locally (npm start) it stays empty and the same server is used.
// TODO: replace the URL below with your deployed backend (Render/Railway/etc.)
const API_BASE = location.hostname.endsWith('github.io')
    ? 'https://YOUR-BACKEND-URL.onrender.com'
    : '';

const MeetingSubjects = [
    { name: "Logic Design and Computer Organization", code: 'TCS-308' },
    { name: "Data Structures with C", code: 'TCS-302' },
    { name: "Object Oriented Programming with C++", code: 'TCS-307' },
    { name: "Discrete Structures and Combinatorics", code: 'TMA-316' },
    { name: "Probability and Statistics (Audit Course)", code: 'TOC-301' },
    { name: "Career Skills-I / PEPCC (QA/Verbal/Soft Skills)", code: 'XCS-301' },
    { name: "UHV-II", code: 'UHV-301' },
    { name: "Fundamentals of Cloud Computing and Big Data", code: 'TCS-351' },
    { name: "Introduction to Cryptography", code: 'TCS-392' },
    { name: "Fundamentals of IoT", code: 'TCS-331' },
    { name: "Python Programming", code: 'TCS-340' },
    { name: "Fundamentals of Information Security and Blockchain", code: 'TCS-332' }
];
// The library: ONE room on the left of the campus building, joined to the hall by a path (see the project sketch).
// No seats: it has one section per subject where students pick up the PDF notes.
const Library = { code: 'LIBRARY', name: 'Library' };

// PDF notes shown in the library (a section on the map + a card in the right-hand panel, per subject).
// The files below are PLACEHOLDERS: replace them in public/notes/ with the real notes (keep the names, or edit
// the list), then run "npm run sync". Add as many files per subject as you like.
const LibraryNotes = {
    'TCS-308': [{ title: 'Complete notes', file: 'notes/TCS-308.pdf' }],
    'TCS-302': [{ title: 'Complete notes', file: 'notes/TCS-302.pdf' }],
    'TCS-307': [{ title: 'Complete notes', file: 'notes/TCS-307.pdf' }],
    'TMA-316': [{ title: 'Complete notes', file: 'notes/TMA-316.pdf' }],
    'TOC-301': [{ title: 'Complete notes', file: 'notes/TOC-301.pdf' }],
    'XCS-301': [{ title: 'Complete notes', file: 'notes/XCS-301.pdf' }],
    'UHV-301': [{ title: 'Complete notes', file: 'notes/UHV-301.pdf' }],
    'TCS-351': [{ title: 'Complete notes', file: 'notes/TCS-351.pdf' }],
    'TCS-392': [{ title: 'Complete notes', file: 'notes/TCS-392.pdf' }],
    'TCS-331': [{ title: 'Complete notes', file: 'notes/TCS-331.pdf' }],
    'TCS-340': [{ title: 'Complete notes', file: 'notes/TCS-340.pdf' }],
    'TCS-332': [{ title: 'Complete notes', file: 'notes/TCS-332.pdf' }]
};
// Room 1..12 on the campus map = the 12 subjects above, in the same order (6 on the top row, 6 on the bottom row).

// ---------- World geometry (fixed world units; the camera follows the avatar) ----------
const World = {
    roomW: 520, roomH: 440, gap: 20, top: 160, hallH: 340,
    margin: 160,     // grass around everything
    perRow: 6,       // rooms per row (2 rows -> 12 classrooms)
    wall: 14,        // thickness of the walls
    band: 44,        // header band on the wall opposite the door (the "board" wall)
    door: 96,        // width of the doorway
    libW: 640,       // width of the library (it is as tall as the campus building)
    libPath: 360,    // length of the path from the hall's left end to the library
    pathW: 200,      // width of that path
    get rowW() { return this.roomW * this.perRow + this.gap * (this.perRow - 1); },
    get padX() { return this.margin + this.libW + this.libPath; }, // left edge of the campus building
    get width() { return this.padX + this.rowW + this.margin; },
    get height() { return this.top * 2 + this.roomH * 2 + this.hallH; },
    get bldW() { return this.rowW; },
    get bldH() { return this.roomH * 2 + this.hallH; }
};

// ---------- Classroom seating ----------
// Every classroom has 4 rows x 2 benches (left / right of a centre aisle) x 3 seats = 24 seats.
// Seat numbers 0..23 are what the server stores (SEAT_COUNT in src/classroom/engine.js must match).
// Positions are described in room-local coordinates: u = across the room, v = from the board towards the door.
const Seating = {
    perSide: 3,
    // classroom: 4 rows = 24 seats (must match the 'seats' of each room in data.json). The library has no seats.
    cfg: {
        classroom: { rows: 4, count: 24, firstV: 90, rowPitch: 72 }
    },
    pitch: 56,       // distance between two seats on a bench
    benchLen: 168,   // 3 seats
    aisleHalf: 48,   // half width of the centre aisle (the doorway is in line with it)
    blockD: 32,      // depth of a desk + bench block
    deskD: 14,       // the desk part of the block (nearest the board)
    benchTop: 16,    // v offset where the bench part starts
    seatV: 24,       // v offset of the seat centre inside a block
    standV: 52,      // v offset where a student stands (walkway behind the bench) to sit down
    sitRange: 50,    // how close a student must be to a seat to sit

    info(idx) {
        const row = Math.floor(idx / 6), side = Math.floor((idx % 6) / 3), k = idx % 3;
        const bench = row * 2 + side + 1;
        return { idx, row, side, k, bench, letter: 'ABC'[k], label: `Bench ${bench} · Seat ${'ABC'[k]}`, short: `B${bench}${'ABC'[k]}` };
    },
    label(idx) { return this.info(idx).label; },
    blockV(row, cfg) { return cfg.firstV + row * cfg.rowPitch; },
    benchU0(side, innerW) { const mid = innerW / 2; return side === 0 ? mid - this.aisleHalf - this.benchLen : mid + this.aisleHalf; },
    seatU(idx, innerW) { const i = this.info(idx); return this.benchU0(i.side, innerW) + this.pitch / 2 + this.pitch * i.k; }
};
