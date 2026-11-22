const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ["classroom", "library"], default: "classroom" },
  seats: { type: Number, default: 24 }, // classroom: 24 (4 rows). The library has no seats (0).
});

module.exports = mongoose.model("Room", roomSchema);
