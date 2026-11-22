const mongoose = require("mongoose");
const config = require("./config");
const Room = require("./models/Room");
const defaults = require("../data.json");

// Classrooms are fixed configuration (data.json): keep the database in line with it on every start.
// Faculty whose assigned classroom no longer exists are moved to the room listed for them in data.json.
async function syncRooms() {
  const User = mongoose.model("User");
  const codes = defaults.rooms.map((r) => r.code);
  for (const r of defaults.rooms) await Room.updateOne({ code: r.code }, { $set: { name: r.name, type: r.type || "classroom", seats: r.seats ?? 24 } }, { upsert: true });
  const removed = await Room.deleteMany({ code: { $nin: codes } });
  let moved = 0;
  for (const u of defaults.users.filter((x) => x.role === "faculty")) {
    const r = await User.updateOne({ role: "faculty", userId: String(u.userId), room: { $nin: codes } }, { $set: { room: u.room } });
    moved += r.modifiedCount;
  }
  // the librarian's home room: the library (an older database may still point at one of the removed library wings)
  const library = defaults.rooms.find((r) => r.type === "library");
  if (library) await User.updateMany({ role: "librarian", room: { $ne: library.code } }, { $set: { room: library.code } });
  if (removed.deletedCount || moved) console.log(`[db] Classrooms updated (${removed.deletedCount} old removed, ${moved} faculty reassigned).`);
}

// The library has one administrator account. It is created once, with a bcrypt-hashed initial password
// (LIBRARIAN_ID / LIBRARIAN_PASSWORD in .env, otherwise the documented defaults). Change it after the first login.
async function ensureLibrarian() {
  const User = mongoose.model("User");
  const { hashPassword } = require("./utils/password");
  const userId = process.env.LIBRARIAN_ID || "LIB001";
  const password = process.env.LIBRARIAN_PASSWORD || "Library@123";
  const home = defaults.rooms.find((r) => r.type === "library");
  const existing = await User.findOne({ role: "librarian" }).select("+passwordHash");
  if (existing && existing.passwordHash) return;
  // no librarian yet, or one without a password: never leave the administrator account claimable through sign-up
  const fields = { passwordHash: await hashPassword(password), passwordSetAt: new Date(), passwordChangedAt: new Date() };
  if (existing) await User.updateOne({ _id: existing._id }, { $set: fields });
  else await User.create({ role: "librarian", userId, name: "Librarian", room: home ? home.code : null, ...fields });
  console.log(`[db] Librarian account ready: ID ${existing ? existing.userId : userId} / password ${process.env.LIBRARIAN_PASSWORD ? "(from .env)" : password}  <- change it after logging in`);
}

async function connect() {
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    console.error("\nCould not connect to MongoDB at " + config.mongoUri.replace(/\/\/[^@]*@/, "//***@"));
    console.error(err.message);
    console.error("Start MongoDB (or set MONGODB_URI in .env) and run again.\n");
    process.exit(1);
  }
  await syncRooms();
  await ensureLibrarian();
  await mongoose.model("User").init(); // make sure the unique index exists
}

module.exports = { connect };
