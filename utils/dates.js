"use strict";

function toMysqlDateTime(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");

  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

function parseMysqlDateTimeToDate(value) {
  return value instanceof Date ? value : new Date(value);
}

module.exports = {
  toMysqlDateTime,
  parseMysqlDateTimeToDate,
};