// Small input validators. Everything that reaches MongoDB must be a plain string:
// that alone stops NoSQL-injection payloads such as { "$ne": null }.
const ROLES = ["student", "faculty", "librarian"];
const ID_RE = /^[A-Za-z0-9_-]{3,32}$/;

const isRole = (v) => typeof v === "string" && ROLES.includes(v);
const isUserId = (v) => typeof v === "string" && ID_RE.test(v.trim());
const clean = (v) => (typeof v === "string" ? v.trim() : "");
const label = (role) => (role === "faculty" ? "Faculty ID" : role === "librarian" ? "Librarian ID" : "Student ID");

module.exports = { ROLES, isRole, isUserId, clean, label };
