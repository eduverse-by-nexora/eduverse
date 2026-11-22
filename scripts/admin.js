#!/usr/bin/env node
// Administrator tool. This is how Student IDs and the special Faculty IDs get into MongoDB.
//
//   npm run admin -- add-student <studentId> [--name "Full Name"] [--email a@b.c]
//   npm run admin -- add-faculty <facultyId> --name "Dr. Sharma" --room TCS-308 [--email a@b.c]
//   npm run admin -- import-students students.csv          (lines: id[,name[,email]])
//   npm run admin -- list [student|faculty]
//   npm run admin -- reset-code <student|faculty> <id>     (one-time 6-digit code, valid 10 minutes)
//   npm run admin -- unlock <student|faculty> <id>
//   npm run admin -- remove <student|faculty> <id>
//   npm run admin -- rooms
//   npm run admin -- generate-faculty-id                    (prints a random, hard-to-guess Faculty ID)
require("dotenv").config({ quiet: true });
const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const config = require("../src/config");
const User = require("../src/models/User");
const Room = require("../src/models/Room");
const pw = require("../src/utils/password");
const { isUserId } = require("../src/utils/validate");

const args = process.argv.slice(2);
const cmd = args.shift();
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const die = (m) => { console.error("Error: " + m); process.exit(1); };

async function main() {
  if (cmd === "generate-faculty-id") {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "F-";
    for (let i = 0; i < 8; i++) s += alphabet[crypto.randomInt(alphabet.length)];
    console.log(s);
    return;
  }
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });

  switch (cmd) {
    case "add-student": {
      const [id] = pos;
      if (!isUserId(id)) die("Give a valid Student ID (3-32 letters, digits, - or _).");
      await User.create({ role: "student", userId: id, name: flags.name || id, email: flags.email || null });
      console.log(`Student ${id} added. They can now set a password on the sign-up page.`);
      break;
    }
    case "add-faculty": {
      const [id] = pos;
      if (!isUserId(id)) die("Give a valid Faculty ID (3-32 letters, digits, - or _).");
      if (!flags.name) die('--name "Dr. Name" is required.');
      if (!flags.room) die("--room <CODE> is required (see: npm run admin -- rooms).");
      if (!(await Room.findOne({ code: flags.room }))) die(`Room ${flags.room} does not exist.`);
      await User.create({ role: "faculty", userId: id, name: flags.name, room: flags.room, email: flags.email || null });
      console.log(`Faculty ${id} (${flags.name}) added to ${flags.room}. They can now set a password on the faculty sign-up page.`);
      break;
    }
    case "import-students": {
      const [file] = pos;
      if (!file || !fs.existsSync(file)) die("CSV file not found.");
      let n = 0, skipped = 0;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const [id, name, email] = line.split(",").map((s) => (s || "").trim());
        if (!id || !isUserId(id)) { if (id) skipped++; continue; }
        const r = await User.updateOne({ role: "student", userId: id }, { $setOnInsert: { role: "student", userId: id, name: name || id, email: email || null, passwordHash: null } }, { upsert: true });
        if (r.upsertedCount) n++; else skipped++;
      }
      console.log(`${n} students added, ${skipped} skipped (invalid or already present).`);
      break;
    }
    case "list": {
      const q = pos[0] ? { role: pos[0] } : {};
      const users = await User.find(q).sort({ role: 1, userId: 1 }).select("+passwordHash").lean();
      console.log("ROLE     ID            NAME                     ROOM    PASSWORD");
      for (const u of users) {
        console.log(`${u.role.padEnd(8)} ${u.userId.padEnd(13)} ${u.name.padEnd(24)} ${(u.room || "-").padEnd(7)} ${u.passwordHash ? "set" : "not set yet"}`);
      }
      console.log(`${users.length} accounts.`);
      break;
    }
    case "reset-code": {
      const [role, id] = pos;
      const user = await User.findOne({ role, userId: id });
      if (!user) die("No such account.");
      const code = pw.newResetCode();
      user.resetCodeHash = pw.hashCode(code);
      user.resetExpiresAt = new Date(Date.now() + config.resetCodeTtlMs);
      user.resetAttempts = 0;
      await user.save();
      console.log(`Reset code for ${role} ${id}: ${code}   (valid ${config.resetCodeTtlMs / 60000} minutes, 5 attempts)`);
      console.log("Give it to the person only after you have verified who they are.");
      break;
    }
    case "unlock": {
      const [role, id] = pos;
      const r = await User.updateOne({ role, userId: id }, { $set: { failedLogins: 0, lockUntil: null } });
      console.log(r.matchedCount ? "Account unlocked." : "No such account.");
      break;
    }
    case "remove": {
      const [role, id] = pos;
      const r = await User.deleteOne({ role, userId: id });
      console.log(r.deletedCount ? "Account removed." : "No such account.");
      break;
    }
    case "rooms": {
      (await Room.find().sort({ code: 1 }).lean()).forEach((r) => console.log(`${r.code.padEnd(7)} ${r.name}`));
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
}

main()
  .catch((e) => die(e.code === 11000 ? "That ID already exists." : e.message))
  .finally(() => mongoose.disconnect());
