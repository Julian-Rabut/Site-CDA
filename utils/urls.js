"use strict";

function sanitizeNextUrl(nextUrl) {
  if (!nextUrl || typeof nextUrl !== "string") return "/rdv";
  if (!nextUrl.startsWith("/")) return "/rdv";
  if (nextUrl.startsWith("//")) return "/rdv";
  return nextUrl;
}

module.exports = {
  sanitizeNextUrl,
};