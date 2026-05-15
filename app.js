"use strict";
require("dotenv").config();

const { injectLocals } = require("./middlewares/locals");
const { startReminderJob } = require("./jobs/reminders");

const authRoutes = require("./routes/auth");
const clientRoutes = require("./routes/client");
const publicRoutes = require("./routes/public");
const dashboardRoutes = require("./routes/dashboard");
const profileRoutes = require("./routes/profile");
const calendarRoutes = require("./routes/calendar");
const apiRoutes = require("./routes/api");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

app.use(helmet({contentSecurityPolicy: false,crossOriginEmbedderPolicy: false,}));
app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(express.json({ limit: "10kb" }));

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET manquant dans le fichier .env");
}

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Trop de tentatives. Réessayez dans quelques minutes.",
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));



app.use(injectLocals);

app.use("/", publicRoutes);
app.use("/auth/login", authLimiter);
app.use("/client/login", authLimiter);
app.use("/client/mot-de-passe-oublie", authLimiter);

app.use("/auth", authRoutes);
app.use("/client", clientRoutes);
app.use("/auth", dashboardRoutes);
app.use("/auth", profileRoutes);
app.use("/auth", calendarRoutes);
app.use("/auth", apiRoutes);

app.use((req, res) => {
  const accept = req.headers.accept || "";
  if (accept.includes("application/json")) {
    return res.status(404).json({ success: false, error: "Not Found" });
  }
  return res.status(404).render("404", { title: "Page introuvable" });
});

if (process.env.NODE_ENV !== "test") {
  startReminderJob();
}

module.exports = app;