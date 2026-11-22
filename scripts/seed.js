// Migrates the old data.json into MongoDB.
//   npm run seed                 -> classrooms + every student / faculty account, WITHOUT passwords
//   npm run seed -- --reset      -> wipe users + rooms first
//
// Passwords are NOT migrated: data.json stored them as plain text. Each person sets their own password
// on the "Set up your password" page (their ID must already exist - that is what this script creates).
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const config = require("../src/config");
const User = require("../src/models/User");
const Room = require("../src/models/Room");
const data = require("../data.json");

(async () => {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  if (process.argv.includes("--reset")) {
    await Promise.all([User.deleteMany({}), Room.deleteMany({})]);
    console.log("Existing users and rooms removed.");
  }

  for (const r of data.rooms) {
    await Room.updateOne({ code: r.code }, { $set: { name: r.name } }, { upsert: true });
  }
  await Room.deleteMany({ code: { $nin: data.rooms.map((r) => r.code) } }); // rooms that are no longer in data.json

  let created = 0, updated = 0;
  for (const u of data.users) {
    const userId = String(u.userId || u.username).trim();
    const res = await User.updateOne(
      { role: u.role, userId },
      {
        $set: { name: u.name, room: u.role === "faculty" ? u.room || null : null },
        $setOnInsert: { role: u.role, userId, passwordHash: null },
      },
      { upsert: true }
    );
    if (res.upsertedCount) created++; else updated++;
  }
  console.log(`Rooms: ${data.rooms.length}. Users created: ${created}, already present: ${updated}.`);
  console.log("Nobody has a password yet - each person sets one on the 'Set up your password' page.");
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
