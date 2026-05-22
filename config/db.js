"use strict";

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host:
    process.env.DB_HOST ||
    process.env.MYSQLHOST ||
    process.env.MYSQL_HOST ||
    "127.0.0.1",

  port: Number(
    process.env.DB_PORT ||
    process.env.MYSQLPORT ||
    process.env.MYSQL_PORT ||
    3306
  ),

  user:
    process.env.DB_USER ||
    process.env.MYSQLUSER ||
    process.env.MYSQL_USER ||
    "root",

  password:
    process.env.DB_PASSWORD ||
    process.env.MYSQLPASSWORD ||
    process.env.MYSQL_PASSWORD ||
    "",

  database:
    process.env.DB_NAME ||
    process.env.MYSQLDATABASE ||
    process.env.MYSQL_DATABASE ||
    "agenda_rdv",

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;