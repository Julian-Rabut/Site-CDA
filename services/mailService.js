"use strict";

const { resend } = require("../config/mail");

async function sendMailSafe({ to, subject, text, html }) {
  try {
    if (process.env.DISABLE_MAIL === "true") {
      console.log("MAIL DISABLED:", subject, "->", to);
      return false;
    }

    if (!resend) {
      console.error("MAIL ERROR: RESEND_API_KEY manquante");
      return false;
    }

    const payload = {
      from: process.env.MAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
    };

    if (html) {
      payload.html = html;
    } else {
      payload.html = `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;">${String(
        text || ""
      )
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</pre>`;
    }

    const { data, error } = await resend.emails.send(payload);

    if (error) {
      console.error("MAIL ERROR DETAIL:", error);
      return false;
    }

    console.log("MAIL SENT:", data?.id || "ok", "->", payload.to.join(", "));
    return true;
  } catch (e) {
    console.error("MAIL ERROR DETAIL:", e);
    return false;
  }
}

module.exports = {
  sendMailSafe,
};