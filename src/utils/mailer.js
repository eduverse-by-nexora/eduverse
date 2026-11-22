const config = require("../config");

let transporter = null;
function getTransporter() {
  if (!config.smtp) return null;
  if (!transporter) transporter = require("nodemailer").createTransport(config.smtp);
  return transporter;
}

// Sends the reset code by e-mail when SMTP is configured and the user has an address on file.
// Returns "email" when sent, "console" when it only went to the server log (development), or null.
async function sendResetCode(user, code) {
  const t = getTransporter();
  if (t && user.email) {
    try {
      await t.sendMail({
        from: config.smtp.from,
        to: user.email,
        subject: "Your EduVerse password reset code",
        text:
          `Hello ${user.name},\n\nYour EduVerse password reset code is ${code}.\n` +
          `It is valid for ${Math.round(config.resetCodeTtlMs / 60000)} minutes. ` +
          `If you did not ask for it, ignore this message - your password has not been changed.\n`,
      });
      return "email";
    } catch (err) {
      console.error("[mail] could not send reset code:", err.message);
    }
  }
  if (!config.isProd) {
    // Development only: no mail server, so the code is printed here.
    console.log(`[reset-code] ${user.role} ${user.userId}: ${code}  (valid ${Math.round(config.resetCodeTtlMs / 60000)} min)  <- development only`);
    return "console";
  }
  return null; // production without e-mail: the administrator issues codes (npm run admin -- reset-code ...)
}

module.exports = { sendResetCode };
