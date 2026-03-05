/* ===================== app.js ===================== */
"use strict";
require("dotenv").config();

const helmet = require("helmet");
const express = require("express");
const session = require("express-session");
const path = require("path");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const nodemailer = require("nodemailer");

const mailTransport = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || "false") === "true", 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
}) : null;


async function consumeFreeSlots(connOrPool, userId, startSql, endSql, excludeCreneauId = null) {
  // Récupère les libres qui chevauchent
  const params = [userId, endSql, startSql];
  let exclude = "";
  if (excludeCreneauId) {
    exclude = "AND id <> ? ";
    params.splice(1, 0, excludeCreneauId); // après userId
  }

  const [free] = await connOrPool.query(
    `
    SELECT id, date_heure_debut, date_heure_fin
    FROM creneaux
    WHERE user_id = ?
      ${exclude}
      AND statut = 'libre'
      AND (date_heure_debut < ? AND date_heure_fin > ?)
    ORDER BY date_heure_debut ASC
    `,
    params
  );

  for (const c of free) {
    const cStart = c.date_heure_debut;
    const cEnd = c.date_heure_fin;

    // cas 1 : le libre est totalement couvert -> delete
    if (cStart >= startSql && cEnd <= endSql) {
      await connOrPool.query("DELETE FROM creneaux WHERE id = ? AND user_id = ?", [c.id, userId]);
      continue;
    }

    // cas 2 : overlap à gauche -> on coupe la fin à start
    if (cStart < startSql && cEnd > startSql && cEnd <= endSql) {
      await connOrPool.query(
        "UPDATE creneaux SET date_heure_fin = ? WHERE id = ? AND user_id = ?",
        [startSql, c.id, userId]
      );
      continue;
    }

    // cas 3 : overlap à droite -> on coupe le début à end
    if (cStart >= startSql && cStart < endSql && cEnd > endSql) {
      await connOrPool.query(
        "UPDATE creneaux SET date_heure_debut = ? WHERE id = ? AND user_id = ?",
        [endSql, c.id, userId]
      );
      continue;
    }

    // cas 4 : le RDV est au milieu d’un créneau libre -> split en 2
    if (cStart < startSql && cEnd > endSql) {
      // on garde la partie gauche sur le record existant
      await connOrPool.query(
        "UPDATE creneaux SET date_heure_fin = ? WHERE id = ? AND user_id = ?",
        [startSql, c.id, userId]
      );
      // on insère la partie droite
      await connOrPool.query(
        "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES (?, ?, ?, 'libre')",
        [userId, endSql, cEnd]
      );
      continue;
    }
  }
}
async function sendMailSafe({ to, subject, text }) {
  try {
    if (process.env.DISABLE_MAIL === "true") {
      console.log("MAIL DISABLED (DEV):", subject, "->", to);
      return;
    }
      if (!mailTransport) return;
      await mailTransport.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
      });
  } catch (e) {
    console.error("MAIL ERROR:", e.message);
  }
}

const cron = require("node-cron");

cron.schedule("*/10 * * * *", async () => {
  try {
    const [rows] = await pool.query(`
      SELECT r.id, r.nom_client, r.email_client, r.type_seance,
             c.date_heure_debut, c.date_heure_fin,
             u.nom AS pro_nom
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      JOIN users u ON u.id = r.user_id
      WHERE r.statut='confirme'
        AND r.reminder_sent=0
        AND r.email_client IS NOT NULL
        AND TIMESTAMPDIFF(MINUTE, NOW(), c.date_heure_debut) BETWEEN 24*60-10 AND 24*60+10
    `);

    for (const r of rows) {
      const debut = new Date(r.date_heure_debut).toLocaleString("fr-FR");
      const fin = new Date(r.date_heure_fin).toLocaleString("fr-FR");

      await sendMailSafe({
        to: r.email_client,
        subject: "Rappel : votre rendez-vous est demain",
        text:
          `Bonjour ${r.nom_client},\n\n` +
          `Petit rappel : vous avez un rendez-vous demain.\n` +
          `Type : ${r.type_seance}\n` +
          `Début : ${debut}\n` +
          `Fin : ${fin}\n\n` +
          `À bientôt,\n${r.pro_nom}`
      });

      await pool.query("UPDATE rdv SET reminder_sent=1 WHERE id=?", [r.id]);
    }
  } catch (e) {
    console.error("Cron rappel 24h error:", e);
  }
});


// ===================== CONFIG =====================
const PORT = process.env.PORT || 8080;

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "agenda_rdv",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});


// ===================== MIDDLEWARE =====================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("trust proxy", 1); 

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret_dev",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Static
app.use(express.static(path.join(__dirname, "public")));

// Variables dispo dans toutes les vues (évite publicPage undefined)
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.publicPage = false;
  next();
});

// ===================== HELPERS =====================
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
}

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
  // mysql2 peut renvoyer string ou Date selon config
  return value instanceof Date ? value : new Date(value);
}

async function hasOverlap(connOrPool, userId, startSql, endSql, excludeId = null) {
  const params = [userId, endSql, startSql];
  let sql = `
    SELECT id
    FROM creneaux
    WHERE user_id = ?
      AND date_heure_debut < ?
      AND date_heure_fin > ?
  `;
  if (excludeId) {
    sql += " AND id <> ? ";
    params.push(excludeId);
  }
  sql += " LIMIT 1";

  const [rows] = await connOrPool.query(sql, params);
  return rows.length > 0;
}


// ===================== ROUTES AUTH (login/register/logout) =====================

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/auth/dashboard");
  return res.redirect("/rdv");
});

app.get("/auth/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;

    if (!email || !mot_de_passe) {
      return res.render("login", { error: "Email et mot de passe requis." });
    }

    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.render("login", { error: "Identifiants invalides." });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.mot_de_passe);
    if (!ok) {
      return res.render("login", { error: "Identifiants invalides." });
    }

    req.session.user = { id: user.id, nom: user.nom, email: user.email, role: user.role };
    return res.redirect("/auth/dashboard");
  } catch (err) {
    console.error(err);
    return res.render("login", { error: "Erreur serveur." });
  }
});

app.get("/auth/register", (req, res) => {
  res.render("register", { error: null });
});

app.post("/auth/register", async (req, res) => {
  try {
    const { nom, email, telephone, mot_de_passe, mot_de_p_p2 } = req.body;

    if (!nom || !email || !mot_de_passe || !mot_de_p_p2) {
      return res.render("register", { error: "Champs requis manquants." });
    }
    if (mot_de_passe !== mot_de_p_p2) {
      return res.render("register", { error: "Les mots de passe ne correspondent pas." });
    }

    const [exists] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (exists.length > 0) {
      return res.render("register", { error: "Email déjà utilisé." });
    }

    const hash = await bcrypt.hash(mot_de_passe, 10);
    await pool.query(
      "INSERT INTO users (nom, email, telephone, mot_de_passe, role) VALUES (?, ?, ?, ?, 'praticien')",
      [nom, email, telephone || null, hash]
    );

    const [u] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    req.session.user = { id: u[0].id, nom: u[0].nom, email: u[0].email, role: u[0].role };

    return res.redirect("/auth/dashboard");
  } catch (err) {
    console.error(err);
    return res.render("register", { error: "Erreur serveur." });
  }
});


app.get("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/auth/login");
  });
});

// ===================== DASHBOARD =====================

app.get("/auth/dashboard", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const error = req.query.error || null;
    const success = req.query.success || null;

    const [creneaux] = await pool.query(
      `
      SELECT *
      FROM creneaux
      WHERE user_id = ?
        AND date_heure_fin >= NOW()
      ORDER BY date_heure_debut ASC
      LIMIT 10
      `,
      [userId]
    );


    const [rdvs] = await pool.query(
      "SELECT * FROM rdv WHERE user_id = ? ORDER BY id DESC LIMIT 5",
      [userId]
    );

    const [typesSeance] = await pool.query(
      "SELECT * FROM types_seance WHERE user_id = ? ORDER BY id DESC",
      [userId]
    );
    const [clients] = await pool.query(
      `
      SELECT 
        nom_client,
        email_client,
        tel_client,
        MAX(created_at) AS derniere_resa
      FROM rdv
      WHERE user_id = ?
      GROUP BY nom_client, email_client, tel_client
      ORDER BY derniere_resa DESC
      LIMIT 5
      `,
      [userId]
    );

    const [clientsAll] = await pool.query(
      `
      SELECT 
        nom_client,
        email_client,
        tel_client,
        MAX(created_at) AS derniere_resa
      FROM rdv
      WHERE user_id = ?
      GROUP BY nom_client, email_client, tel_client
      ORDER BY derniere_resa DESC
      LIMIT 200
      `,
      [userId]
    );

    const [creneauxLibres] = await pool.query(
      `SELECT id, date_heure_debut, date_heure_fin, statut
      FROM creneaux
      WHERE user_id = ? AND statut = 'libre'
      ORDER BY date_heure_debut ASC`,
      [req.session.user.id]
    );

    res.render("dashboard", {
      error,
      success,
      creneaux,
      rdvs,
      typesSeance,
      creneauxLibres,
      clients,
      clientsAll,
    });
  } catch (err) {
    console.error("Erreur dashboard:", err);
    res.render("dashboard", {
      error: "Erreur serveur.",
      success: null,
      creneaux: [],
      rdvs: [],
      typesSeance: [],
      clients: [],
    });
  }
});

app.get("/auth/clients", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const q = (req.query.q || "").trim();

    const params = [userId];
    let whereQ = "";
    if (q) {
      whereQ = "AND (nom_client LIKE ? OR email_client LIKE ? OR tel_client LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const [clients] = await pool.query(
      `
      SELECT 
        nom_client,
        email_client,
        tel_client,
        COUNT(*) AS nombre_rdv,
        MAX(created_at) AS dernier_rdv
      FROM rdv
      WHERE user_id = ? AND statut <> 'annule'
      ${whereQ}
      GROUP BY nom_client, email_client, tel_client
      ORDER BY dernier_rdv DESC
      `,
      params
    );

    res.render("clients", { q, clients });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

app.get("/auth/rdvs", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const q = (req.query.q || "").trim();
    const statut = (req.query.statut || "").trim(); // confirme | annule | libre | ""

    let rdvs = [];
    if (!statut || statut === "confirme" || statut === "annule") {
      const params = [userId];
      let where = "";

      if (statut && statut !== "libre") {
        where += " AND r.statut = ? ";
        params.push(statut);
      }

      if (q) {
        where += " AND (r.nom_client LIKE ? OR r.email_client LIKE ? OR r.tel_client LIKE ? OR r.type_seance LIKE ?) ";
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }

      const [rows] = await pool.query(
        `
        SELECT 
          r.*,
          c.date_heure_debut, c.date_heure_fin
        FROM rdv r
        JOIN creneaux c ON c.id = r.creneau_id
        WHERE r.user_id = ?
        ${where}
        ORDER BY c.date_heure_debut DESC
        LIMIT 500
        `,
        params
      );
      rdvs = rows;
    }

    let libres = [];
    if (!statut || statut === "libre") {
      const [rows] = await pool.query(
        `
        SELECT id, date_heure_debut, date_heure_fin
        FROM creneaux
        WHERE user_id = ?
          AND statut = 'libre'
          AND date_heure_fin >= NOW()
        ORDER BY date_heure_debut DESC
        LIMIT 500
        `,
        [userId]
      );
      libres = rows;
    }

    const items = [
      ...rdvs.map(r => ({
        date_heure_debut: r.date_heure_debut,
        date_heure_fin: r.date_heure_fin,
        nom_client: r.nom_client,
        email_client: r.email_client,
        tel_client: r.tel_client,
        type_seance: r.type_seance,
        commentaire: r.commentaire,
        statut: r.statut
      })),
      ...libres.map(c => ({
        date_heure_debut: c.date_heure_debut,
        date_heure_fin: c.date_heure_fin,
        nom_client: null,
        email_client: null,
        tel_client: null,
        type_seance: null,
        commentaire: null,
        statut: "libre"
      }))
    ].sort((a,b) => new Date(b.date_heure_debut) - new Date(a.date_heure_debut));

    res.render("rdvs", { q, statut, items });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

// Page : modifier date/heure d'un RDV (depuis le bouton de la modale calendrier)
app.get("/auth/rdv/:id/modifier-datetime", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;

    const [rows] = await pool.query(
      `
      SELECT r.id, r.nom_client, r.type_seance, r.type_seance_id, r.commentaire,
             c.date_heure_debut, c.date_heure_fin
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );
    if (rows.length === 0) return res.redirect("/auth/calendar");

    const rdv = rows[0];
    const dStart = parseMysqlDateTimeToDate(rdv.date_heure_debut);

    const yyyy = dStart.getFullYear();
    const mm = String(dStart.getMonth() + 1).padStart(2, "0");
    const dd = String(dStart.getDate()).padStart(2, "0");
    const hh = String(dStart.getHours()).padStart(2, "0");
    const mi = String(dStart.getMinutes()).padStart(2, "0");

    res.render("modifier-rdv-datetime", {
      user: req.session.user,
      rdv,
      defaultDate: `${yyyy}-${mm}-${dd}`,
      defaultTime: `${hh}:${mi}`,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error("Erreur GET modifier datetime:", err);
    return res.redirect("/auth/calendar");
  }
});

app.post("/auth/rdv/:id/modifier-datetime", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;
    const { date, time } = req.body;

    if (!date || !time) {
      return res.redirect(`/auth/rdv/${rdvId}/modifier-datetime?error=` + encodeURIComponent("Date/heure manquante."));
    }

    // Récupérer RDV + créneau pour conserver la durée
    const [rows] = await pool.query(
      `
      SELECT r.id, r.creneau_id, c.date_heure_debut, c.date_heure_fin
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );
    if (rows.length === 0) return res.redirect("/auth/calendar");

    const rdv = rows[0];
    const oldStart = parseMysqlDateTimeToDate(rdv.date_heure_debut);
    const oldEnd = parseMysqlDateTimeToDate(rdv.date_heure_fin);
    const durMs = Math.max(5 * 60 * 1000, oldEnd.getTime() - oldStart.getTime());

    const newStart = new Date(`${date}T${time}:00`);
    if (isNaN(newStart.getTime())) {
      return res.redirect(`/auth/rdv/${rdvId}/modifier-datetime?error=` + encodeURIComponent("Date/heure invalide."));
    }
    const newEnd = new Date(newStart.getTime() + durMs);

    const startSql = toMysqlDateTime(newStart.toISOString());
    const endSql = toMysqlDateTime(newEnd.toISOString());

    // Chevauchement (on exclut le créneau actuel)
    const overlap = await hasOverlap(pool, userId, startSql, endSql, rdv.creneau_id);
    if (overlap) {
      return res.redirect(`/auth/rdv/${rdvId}/modifier-datetime?error=` + encodeURIComponent("Chevauchement détecté."));
    }

    // Update
    await pool.query(
      "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ? AND user_id = ?",
      [startSql, endSql, rdv.creneau_id, userId]
    );

    return res.redirect("/auth/calendar");
  } catch (err) {
    console.error("Erreur POST modifier datetime:", err);
    return res.redirect("/auth/calendar");
  }
});


// Page modifier RDV (date/heure)
app.get("/auth/rdvs/:id/modifier", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;

    const [rows] = await pool.query(
      `
      SELECT r.*, c.date_heure_debut, c.date_heure_fin
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );
    if (rows.length === 0) return res.redirect("/auth/rdvs");

    const rdv = rows[0];
    const dStart = parseMysqlDateTimeToDate(rdv.date_heure_debut);

    const yyyy = dStart.getFullYear();
    const mm = String(dStart.getMonth() + 1).padStart(2, "0");
    const dd = String(dStart.getDate()).padStart(2, "0");
    const hh = String(dStart.getHours()).padStart(2, "0");
    const mi = String(dStart.getMinutes()).padStart(2, "0");

    res.render("modifier-rdv", {
      user: req.session.user,
      rdv,
      defaultDate: `${yyyy}-${mm}-${dd}`,
      defaultTime: `${hh}:${mi}`,
    });
  } catch (err) {
    console.error("Erreur page modifier rdv:", err);
    return res.redirect("/auth/rdvs");
  }
});

app.post("/auth/rdvs/:id/modifier", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;
    const { date, time } = req.body;

    if (!date || !time) return res.redirect(`/auth/rdvs/${rdvId}/modifier`);

    // récupérer RDV + créneau pour garder durée
    const [rows] = await pool.query(
      `
      SELECT r.id, r.creneau_id, c.date_heure_debut, c.date_heure_fin
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );
    if (rows.length === 0) return res.redirect("/auth/rdvs");

    const rdv = rows[0];

    const oldStart = parseMysqlDateTimeToDate(rdv.date_heure_debut);
    const oldEnd = parseMysqlDateTimeToDate(rdv.date_heure_fin);
    const durMs = Math.max(5 * 60 * 1000, oldEnd.getTime() - oldStart.getTime());

    const newStart = new Date(`${date}T${time}:00`);
    if (isNaN(newStart.getTime())) return res.redirect(`/auth/rdvs/${rdvId}/modifier`);

    const newEnd = new Date(newStart.getTime() + durMs);

    const startSql = toMysqlDateTime(newStart.toISOString());
    const endSql = toMysqlDateTime(newEnd.toISOString());

    const overlap = await hasOverlap(pool, userId, startSql, endSql, rdv.creneau_id);
    if (overlap) {
      return res.redirect(`/auth/rdvs/${rdvId}/modifier?error=` + encodeURIComponent("Chevauchement détecté."));
    }

    await pool.query(
      "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ? AND user_id = ?",
      [startSql, endSql, rdv.creneau_id, userId]
    );

    return res.redirect("/auth/rdvs");
  } catch (err) {
    console.error("Erreur modifier rdv date:", err);
    return res.redirect("/auth/rdvs");
  }
});



// Ajouter créneau depuis dashboard
app.post("/auth/creneaux", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const { date_heure_debut, date_heure_fin } = req.body;
    const { date_debut, heure_debut, duree_minutes } = req.body;

    let start, end;

    if (date_heure_debut && date_heure_fin) {
      start = new Date(date_heure_debut);
      end = new Date(date_heure_fin);
    } else if (date_debut && heure_debut && duree_minutes) {
      start = new Date(`${date_debut}T${heure_debut}:00`);
      const dur = parseInt(duree_minutes, 10);
      if (isNaN(dur) || dur <= 0) {
        return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Durée invalide."));
      }
      end = new Date(start.getTime() + dur * 60000);
    } else {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Champs requis manquants."));
    }

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Dates invalides."));
    }

    const startSql = toMysqlDateTime(start.toISOString());
    const endSql = toMysqlDateTime(end.toISOString());

    const overlap = await hasOverlap(pool, userId, startSql, endSql);
    if (overlap) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Superposition détectée : impossible d'ajouter ce créneau."));
    }

    await pool.query(
      "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES (?, ?, ?, 'libre')",
      [userId, startSql, endSql]
    );


    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Créneau ajouté "));
  } catch (err) {
    console.error(err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});

app.post("/auth/types-seance", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { nom, duree_minutes, couleur } = req.body;

    if (!nom || !duree_minutes) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Champs requis manquants."));
    }

    const d = parseInt(duree_minutes, 10);
    if (isNaN(d) || d <= 0) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Durée invalide."));
    }

    await pool.query(
      "INSERT INTO types_seance (user_id, nom, duree_minutes, couleur) VALUES (?, ?, ?, ?)",
      [userId, nom.trim(), d, couleur || null]
    );

    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Type de séance ajouté "));
  } catch (err) {
    console.error(err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});

app.post("/auth/types-seance/:id/delete", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const typeId = Number(req.params.id);

    if (!typeId) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Type invalide."));
    }

    // 1) Bloquer si un RDV futur utilise ce type
    const [used] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM rdv
      JOIN creneaux c ON c.id = rdv.creneau_id
      WHERE rdv.user_id = ?
        AND rdv.type_seance_id = ?
        AND c.date_heure_debut > NOW()
        AND (rdv.statut IS NULL OR rdv.statut != 'annule')
      `,
      [userId, typeId]
    );

    if (used[0].total > 0) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Impossible de supprimer : type utilisé dans des RDV futurs."));
    }

    // 2) Supprimer le type (uniquement celui du user)
    await pool.query(
      "DELETE FROM types_seance WHERE id = ? AND user_id = ?",
      [typeId, userId]
    );

    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Type de séance supprimé."));
  } catch (err) {
    console.error(err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});

app.post("/auth/rdv-manuel", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const {
      creneau_id,
      nom_client,
      email_client,
      tel_client,
      type_seance_id,
      type_seance_libre,
    } = req.body;

    if (!creneau_id || !nom_client || !type_seance_id) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Merci de choisir un type de séance."));
    }


    // Vérifier créneau libre
    const [rows] = await pool.query(
      "SELECT * FROM creneaux WHERE id = ? AND user_id = ?",
      [creneau_id, userId]
    );

    if (rows.length === 0) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Créneau introuvable."));
    }

    const c = rows[0];
    if (c.statut !== "libre") {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Créneau non disponible."));
    }

    let typeSeanceTexte = type_seance_libre ? type_seance_libre.trim() : null;
    let typeSeanceIdFinal = type_seance_id || null;

    if (type_seance_id) {
      const [t] = await pool.query(
        "SELECT nom FROM types_seance WHERE id = ? AND user_id = ?",
        [type_seance_id, userId]
      );
      if (t.length > 0) typeSeanceTexte = t[0].nom;
    }

    // Ajuster la fin du créneau selon la durée du type de séance 
    let dureeMinutes = null;

    if (type_seance_id) {
      const [t2] = await pool.query(
        "SELECT duree_minutes FROM types_seance WHERE id = ? AND user_id = ?",
        [type_seance_id, userId]
      );
      if (t2.length > 0) dureeMinutes = parseInt(t2[0].duree_minutes, 10);
    }

    if (!dureeMinutes || isNaN(dureeMinutes) || dureeMinutes <= 0) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Durée du type de séance invalide."));
    }

    const startDate = parseMysqlDateTimeToDate(c.date_heure_debut);
    const desiredEnd = new Date(startDate.getTime() + dureeMinutes * 60000);

    const startSql = toMysqlDateTime(startDate.toISOString());
    const endSql = toMysqlDateTime(desiredEnd.toISOString());

    const [hard] = await pool.query(
      `
      SELECT id FROM creneaux
      WHERE user_id = ?
        AND statut <> 'libre'
        AND date_heure_debut < ?
        AND date_heure_fin > ?
      LIMIT 1
      `,
      [userId, endSql, startSql]
    );
    if (hard.length) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Chevauchement RDV/blocage."));
    }

    await consumeFreeSlots(pool, userId, startSql, endSql);

    await pool.query(
      "UPDATE creneaux SET date_heure_fin = ? WHERE id = ? AND user_id = ?",
      [endSql, c.id, userId]
);


    await pool.query(
      "INSERT INTO rdv (user_id, creneau_id, nom_client, email_client, tel_client, type_seance, type_seance_id, statut) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirme')",
      [
        userId,
        creneau_id,
        nom_client.trim(),
        email_client || null,
        tel_client || null,
        typeSeanceTexte,
        typeSeanceIdFinal,
      ]
    );

    await pool.query("UPDATE creneaux SET statut = 'reserve' WHERE id = ?", [creneau_id]);

    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Rendez-vous créé "));
  } catch (err) {
    console.error(err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});


// ================== BLOQUER / LIBÉRER (Dashboard) ==================
app.post("/auth/creneaux/:id/bloquer", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const creneauId = req.params.id;

    const [rows] = await pool.query(
      "SELECT id, statut FROM creneaux WHERE id = ? AND user_id = ?",
      [creneauId, userId]
    );
    if (rows.length === 0) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Créneau introuvable."));
    }

    if (rows[0].statut !== "libre") {
      return res.redirect(
        "/auth/dashboard?error=" + encodeURIComponent("Seuls les créneaux libres peuvent être bloqués.")
      );
    }

    await pool.query("UPDATE creneaux SET statut = 'bloque' WHERE id = ? AND user_id = ?", [
      creneauId,
      userId,
    ]);

    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Créneau bloqué "));
  } catch (err) {
    console.error("Erreur bloquer créneau :", err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});

app.post("/auth/creneaux/:id/liberer", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const creneauId = req.params.id;

    const [rows] = await pool.query(
      "SELECT id, statut FROM creneaux WHERE id = ? AND user_id = ?",
      [creneauId, userId]
    );
    if (rows.length === 0) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Créneau introuvable."));
    }

    if (rows[0].statut !== "bloque") {
      return res.redirect(
        "/auth/dashboard?error=" + encodeURIComponent("Seuls les créneaux bloqués peuvent être libérés.")
      );
    }

    await pool.query("UPDATE creneaux SET statut = 'libre' WHERE id = ? AND user_id = ?", [
      creneauId,
      userId,
    ]);

    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Créneau libéré "));
  } catch (err) {
    console.error("Erreur liberer créneau :", err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});

app.post("/auth/api/creneaux/:id/liberer", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { id } = req.params;

    const [rows] = await pool.query("SELECT * FROM creneaux WHERE id = ? AND user_id = ?", [id, userId]);
    if (rows.length === 0) return res.json({ success: false, error: "Créneau introuvable." });

    // On libère uniquement si c'est bloqué
    await pool.query("DELETE FROM creneaux WHERE id = ? AND user_id = ? AND statut = 'bloque'", [id, userId]);


    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});


// =================== API CALENDRIER (FullCalendar) ===================== //

// Page calendrier
app.get("/auth/calendar", requireLogin, (req, res) => {
  res.render("calendar", { user: req.session.user });
});

// Page fiche pro
app.get("/auth/profil", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [rows] = await pool.query("SELECT * FROM pro_profile WHERE user_id = ? LIMIT 1", [userId]);
    const profile = rows.length ? rows[0] : { user_id: userId };
    const [types] = await pool.query(
      "SELECT id, nom, duree_minutes, description FROM types_seance WHERE user_id = ? ORDER BY id DESC",
      [req.session.user.id]
    );
    res.render("profil-pro", { user: req.session.user, profile, types });
  } catch (err) {
    console.error("Erreur GET /auth/profil:", err);
    res.redirect("/auth/calendar");
  }
});

app.post("/auth/profil", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const {
      titre, description, adresse, ville, telephone, email_public,
      paiement, regles, itineraire_url,
      photo_url, tarifs, horaires, description_seances
    } = req.body;

    // Normalisation URL itinéraire 
    let itineraire = (itineraire_url || "").trim();
    if (itineraire && !/^https?:\/\//i.test(itineraire)) {
      itineraire = "https://" + itineraire;
    }

    // Normalisation photo_url 
    let photo = (photo_url || "").trim();
    if (photo && /^[A-Za-z]:\\/.test(photo)) {
      photo = "";
    }

    await pool.query(
      `
      INSERT INTO pro_profile
        (user_id, titre, description, adresse, ville, telephone, email_public, paiement, regles, itineraire_url, photo_url, tarifs, horaires, description_seances)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        titre = VALUES(titre),
        description = VALUES(description),
        adresse = VALUES(adresse),
        ville = VALUES(ville),
        telephone = VALUES(telephone),
        email_public = VALUES(email_public),
        paiement = VALUES(paiement),
        regles = VALUES(regles),
        itineraire_url = VALUES(itineraire_url),
        photo_url = VALUES(photo_url),
        tarifs = VALUES(tarifs),
        horaires = VALUES(horaires),
        description_seances = VALUES(description_seances)
      `,
      [
        userId,
        titre || null,
        description || null,
        adresse || null,
        ville || null,
        telephone || null,
        email_public || null,
        paiement || null,
        regles || null,
        itineraire || null,
        photo || null,
        tarifs || null,
        horaires || null,
        description_seances || null
      ]
    );

    res.redirect("/auth/profil");
  } catch (err) {
    console.error("Erreur POST /auth/profil:", err);
    res.redirect("/auth/profil");
  }
});


// Page modifier RDV (complète)
app.get("/auth/rdv/:id/modifier", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;

    const [rows] = await pool.query(
      `
      SELECT r.id, r.nom_client, r.email_client, r.tel_client, r.commentaire,
             r.type_seance_id, r.type_seance,
             c.date_heure_debut, c.date_heure_fin
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );
    if (rows.length === 0) return res.redirect("/auth/calendar");

    const rdv = rows[0];
    const dStart = parseMysqlDateTimeToDate(rdv.date_heure_debut);

    const yyyy = dStart.getFullYear();
    const mm = String(dStart.getMonth() + 1).padStart(2, "0");
    const dd = String(dStart.getDate()).padStart(2, "0");
    const hh = String(dStart.getHours()).padStart(2, "0");
    const mi = String(dStart.getMinutes()).padStart(2, "0");

    const [typesSeance] = await pool.query(
      "SELECT id, nom, duree_minutes FROM types_seance WHERE user_id = ? ORDER BY nom",
      [userId]
    );

    res.render("modifier-rdv-complet", {
      user: req.session.user,
      rdv,
      typesSeance,
      defaultDate: `${yyyy}-${mm}-${dd}`,
      defaultTime: `${hh}:${mi}`,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error("Erreur GET /auth/rdv/:id/modifier:", err);
    return res.redirect("/auth/calendar");
  }
});

app.post("/auth/rdv/:id/modifier", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;

    const [rows] = await pool.query(
      `
      SELECT r.id, r.creneau_id, r.type_seance_id,
             c.date_heure_debut, c.date_heure_fin
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );
    if (rows.length === 0) return res.redirect("/auth/calendar");

    const rdv = rows[0];

    // ----- updates infos -----
    const updates = {};
    if (req.body.edit_nom === "1") updates.nom_client = req.body.nom_client || "";
    if (req.body.edit_email === "1") updates.email_client = req.body.email_client || "";
    if (req.body.edit_tel === "1") updates.tel_client = req.body.tel_client || "";
    if (req.body.edit_commentaire === "1") updates.commentaire = req.body.commentaire || null;

    if (req.body.edit_type === "1") {
      const tid = req.body.type_seance_id ? Number(req.body.type_seance_id) : null;
      updates.type_seance_id = tid;

      if (req.body.edit_type === "1") {
        const newTypeId = req.body.type_seance_id ? Number(req.body.type_seance_id) : null;

        if (newTypeId) {
          // récupérer durée du nouveau type
          const [trows] = await pool.query(
            "SELECT duree_minutes FROM types_seance WHERE id = ? AND user_id = ? LIMIT 1",
            [newTypeId, userId]
          );
          const dm = trows.length ? parseInt(trows[0].duree_minutes, 10) : NaN;

          if (!isNaN(dm) && dm > 0) {
            // récupérer le début actuel du créneau réservé
            const [crows] = await pool.query(
              "SELECT date_heure_debut, id FROM creneaux WHERE id = ? AND user_id = ? LIMIT 1",
              [rdv.creneau_id, userId]
            );

            if (crows.length) {
              const startDate = parseMysqlDateTimeToDate(crows[0].date_heure_debut);
              const newEnd = new Date(startDate.getTime() + dm * 60 * 1000);

              const startSql = toMysqlDateTime(startDate.toISOString());
              const endSql = toMysqlDateTime(newEnd.toISOString());

              // chevauchement : exclure le créneau actuel
              const overlap = await hasOverlap(pool, userId, startSql, endSql, rdv.creneau_id);
              if (overlap) {
                return res.redirect(`/auth/rdv/${rdvId}/modifier?error=` + encodeURIComponent("Chevauchement : impossible avec la nouvelle durée."));
              }

              await pool.query(
                "UPDATE creneaux SET date_heure_fin = ? WHERE id = ? AND user_id = ?",
                [endSql, rdv.creneau_id, userId]
              );
            }
          }
        }
      }


      if (tid) {
        const [trows] = await pool.query(
          "SELECT nom FROM types_seance WHERE id = ? AND user_id = ? LIMIT 1",
          [tid, userId]
        );
        updates.type_seance = trows.length ? trows[0].nom : null;
      } else {
        updates.type_seance = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      const fields = Object.keys(updates).map(k => `${k} = ?`).join(", ");
      const values = Object.keys(updates).map(k => updates[k]);
      await pool.query(`UPDATE rdv SET ${fields} WHERE id = ? AND user_id = ?`, [...values, rdvId, userId]);
    }

    // ----- update datetime (si coché) -----
    if (req.body.edit_datetime === "1") {
      const { date, time } = req.body;
      if (!date || !time) {
        return res.redirect(`/auth/rdv/${rdvId}/modifier?error=` + encodeURIComponent("Date/heure manquante."));
      }

      const oldStart = parseMysqlDateTimeToDate(rdv.date_heure_debut);
      const oldEnd = parseMysqlDateTimeToDate(rdv.date_heure_fin);

      let durMs = 0;
      const d1 = oldStart && !isNaN(oldStart.getTime()) ? oldStart.getTime() : null;
      const d2 = oldEnd && !isNaN(oldEnd.getTime()) ? oldEnd.getTime() : null;

      if (d1 !== null && d2 !== null && d2 > d1) {
        durMs = d2 - d1;
      } else {
        const [trows] = await pool.query(
          "SELECT duree_minutes FROM types_seance WHERE id = ? AND user_id = ? LIMIT 1",
          [rdv.type_seance_id, userId]
        );
        const dm = trows.length ? parseInt(trows[0].duree_minutes, 10) : NaN;
        durMs = (!isNaN(dm) && dm > 0) ? dm * 60 * 1000 : 60 * 60 * 1000;
      }

      const newStart = new Date(`${date}T${time}:00`);
      if (isNaN(newStart.getTime())) {
        return res.redirect(`/auth/rdv/${rdvId}/modifier?error=` + encodeURIComponent("Date/heure invalide."));
      }

      const newEnd = new Date(newStart.getTime() + durMs);
      const startSql = toMysqlDateTime(newStart.toISOString());
      const endSql = toMysqlDateTime(newEnd.toISOString());

      const overlap = await hasOverlap(pool, userId, startSql, endSql, rdv.creneau_id);
      if (overlap) {
        return res.redirect(`/auth/rdv/${rdvId}/modifier?error=` + encodeURIComponent("Chevauchement détecté."));
      }

      await pool.query(
        "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ? AND user_id = ?",
        [startSql, endSql, rdv.creneau_id, userId]
      );
    }

    return res.redirect("/auth/calendar");
  } catch (err) {
    console.error("Erreur POST /auth/rdv/:id/modifier:", err);
    return res.redirect("/auth/calendar");
  }
});

// Pages UI 
app.get("/auth/journee/generer", requireLogin, (req, res) => {
  res.render("generer-journee", { user: req.session.user });
});

app.post("/auth/journee/generer", requireLogin, async (req, res) => {
  try {
    const { date, startTime, endTime, slotMinutes, breakMinutes } = req.body;

    // on réutilise ton endpoint API existant
    const payload = {
      date,
      startTime,
      endTime,
      slotMinutes: Number(slotMinutes),
      breakMinutes: Number(breakMinutes || 0),
    };

    req.body = payload;

    const userId = req.session.user.id;

    if (!date || !startTime || !endTime || !payload.slotMinutes) {
      return res.redirect("/auth/journee/generer?error=" + encodeURIComponent("Paramètres manquants."));
    }

    const slotM = parseInt(payload.slotMinutes, 10);
    const breakM = parseInt(payload.breakMinutes || 0, 10);

    if (isNaN(slotM) || slotM <= 0) {
      return res.redirect("/auth/journee/generer?error=" + encodeURIComponent("Durée créneau invalide."));
    }
    if (isNaN(breakM) || breakM < 0) {
      return res.redirect("/auth/journee/generer?error=" + encodeURIComponent("Pause invalide."));
    }

    let cursor = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);
    if (cursor >= end) {
      return res.redirect("/auth/journee/generer?error=" + encodeURIComponent("Heures invalides."));
    }

    const inserts = [];
    while (cursor < end) {
      const slotStart = new Date(cursor.getTime());
      const slotEnd = new Date(slotStart.getTime() + slotM * 60000);
      if (slotEnd > end) break;

      const sSql = toMysqlDateTime(slotStart.toISOString());
      const eSql = toMysqlDateTime(slotEnd.toISOString());

      const overlap = await hasOverlap(pool, userId, sSql, eSql);
      if (!overlap) inserts.push([userId, sSql, eSql, "libre"]);

      cursor = new Date(slotEnd.getTime() + breakM * 60000);
    }

    if (inserts.length === 0) {
      return res.redirect("/auth/journee/generer?error=" + encodeURIComponent("Aucun créneau généré."));
    }

    await pool.query(
      "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES ?",
      [inserts]
    );

    await pool.query(
      `
      INSERT INTO journees (user_id, date_jour, start_time, end_time)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time)
      `,
      [userId, date, startTime, endTime]
    );

    return res.redirect("/auth/calendar");
  } catch (err) {
    console.error("Erreur page generer:", err);
    return res.redirect("/auth/journee/generer?error=" + encodeURIComponent("Erreur serveur."));
  }
});

app.get("/auth/journee/bloquer", requireLogin, (req, res) => {
  res.render("bloquer-journee", { user: req.session.user });
});

app.post("/auth/journee/bloquer", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date, commentaire } = req.body;

    if (!date) {
      return res.redirect("/auth/journee/bloquer?error=" + encodeURIComponent("Date manquante."));
    }

    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59`);
    const startSql = toMysqlDateTime(start.toISOString());
    const endSql = toMysqlDateTime(end.toISOString());

    const overlap = await hasOverlap(pool, userId, startSql, endSql);
    if (overlap) {
      return res.redirect("/auth/journee/bloquer?error=" + encodeURIComponent("Superposition : il existe déjà des créneaux/RDV."));
    }

    await pool.query(
      "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut, commentaire) VALUES (?, ?, ?, 'bloque', ?)",
      [userId, startSql, endSql, commentaire ? String(commentaire).slice(0,255) : null]
    );

    return res.redirect("/auth/calendar");
  } catch (err) {
    console.error("Erreur page bloquer:", err);
    return res.redirect("/auth/journee/bloquer?error=" + encodeURIComponent("Erreur serveur."));
  }
});

// Liste clients (pour auto-remplissage)
app.get("/auth/api/clients", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [clients] = await pool.query(
      `
      SELECT 
        nom_client,
        email_client,
        tel_client,
        MAX(created_at) AS derniere_resa
      FROM rdv
      WHERE user_id = ?
      GROUP BY nom_client, email_client, tel_client
      ORDER BY derniere_resa DESC
      LIMIT 200
      `,
      [userId]
    );

    res.json({ success: true, clients });
  } catch (e) {
    console.error("Erreur /auth/api/clients:", e);
    res.json({ success: false, error: "Erreur serveur." });
  }
});

app.get("/auth/api/stats/clients-par-mois", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    // stats réelles par mois
    const [rows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS mois,
        COUNT(DISTINCT CONCAT(IFNULL(nom_client,''),'|',IFNULL(email_client,''),'|',IFNULL(tel_client,''))) AS nb
      FROM rdv
      WHERE user_id = ?
        AND statut <> 'annule'
      GROUP BY mois
      ORDER BY mois
      `,
      [userId]
    );

    const map = new Map(rows.map(r => [r.mois, Number(r.nb || 0)]));

    const now = new Date();
    const labels = [];
    const values = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; // ✅ local YYYY-MM
      labels.push(key);
      values.push(map.get(key) ?? 0);
    }

    res.json({ success: true, labels, values });
  } catch (e) {
    console.error("Erreur stats clients/mois:", e);
    res.json({ success: false, error: "Erreur serveur." });
  }
});

// Events pour FullCalendar
app.get("/auth/api/events", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [creneaux] = await pool.query(
      "SELECT id, date_heure_debut, date_heure_fin, statut, commentaire FROM creneaux WHERE user_id = ?",
      [userId]
    );

    const [rdvs] = await pool.query(
      `SELECT 
          r.id, r.creneau_id, r.nom_client, r.email_client, r.tel_client,
          r.commentaire,
          r.type_seance, r.type_seance_id, r.statut,
          ts.couleur AS type_couleur
      FROM rdv r
      LEFT JOIN types_seance ts ON ts.id = r.type_seance_id
      WHERE r.user_id = ?`,
      [userId]
    );




    const events = [];

    // Créneaux (libre / bloque / reserve)
    for (const c of creneaux) {
      let color = "#16a34a"; 
      let title = "Créneau libre";

      if (c.statut === "bloque") {
        color = "#dc2626";
        title = c.commentaire
          ? `Bloqué: ${c.commentaire}`
          : "Créneau bloqué";
      } 
      else if (c.statut === "reserve") {
        continue;
      }


      events.push({
        id: `c-${c.id}`,
        title,
        start: parseMysqlDateTimeToDate(c.date_heure_debut).toISOString(),
        end: parseMysqlDateTimeToDate(c.date_heure_fin).toISOString(),
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          type: "creneau",
          statut: c.statut,
        },
      });
    }

    // RDV
    for (const r of rdvs) {
      let color = r.type_couleur || "#2563eb";
      let title = r.nom_client || "RDV";

      if (r.statut === "annule") {
        continue;
      }


      const c = creneaux.find((x) => String(x.id) === String(r.creneau_id));
      if (!c) continue;

      events.push({
        id: `r-${r.id}`,
        title,
        start: parseMysqlDateTimeToDate(c.date_heure_debut).toISOString(),
        end: parseMysqlDateTimeToDate(c.date_heure_fin).toISOString(),
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          type: "rdv",
          nom_client: r.nom_client,
          email_client: r.email_client,
          tel_client: r.tel_client,
          commentaire: r.commentaire,
          type_seance: r.type_seance,
          type_seance_id: r.type_seance_id,
          statut: r.statut,
        },
      });
    }

    return res.json(events);
  } catch (err) {
    console.error("Erreur events:", err);
    return res.status(500).json([]);
  }
});

// Types de séance
app.get("/auth/api/types-seance", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [types] = await pool.query(
      "SELECT id, nom, duree_minutes, couleur FROM types_seance WHERE user_id = ? ORDER BY nom ASC",
      [userId]
    );
    return res.json({ success: true, types });
  } catch (err) {
    console.error("Erreur types-seance:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

// Création créneau depuis calendrier (clic vide)
app.post("/auth/api/creneaux-from-calendar", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { start, end } = req.body;

    if (!start || !end) {
      return res.json({ success: false, error: "Dates manquantes." });
    }

    const startSql = toMysqlDateTime(start);
    const endSql = toMysqlDateTime(end);

    const overlap = await hasOverlap(pool, userId, startSql, endSql);
    if (overlap) return res.json({ success:false, error:"Superposition détectée : impossible de créer ce créneau." });


    await pool.query(
      "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES (?, ?, ?, 'libre')",
      [userId, startSql, endSql]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur create creneau:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

// Déplacer un créneau libre (depuis modale)
app.post("/auth/api/creneaux/:id/move", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const creneauId = req.params.id;
    const { start, end } = req.body;

    if (!start || !end) {
      return res.json({ success: false, error: "Dates manquantes." });
    }

    const [rows] = await pool.query("SELECT * FROM creneaux WHERE id = ? AND user_id = ?", [
      creneauId,
      userId,
    ]);
    if (rows.length === 0) return res.json({ success: false, error: "Créneau introuvable." });

    const c = rows[0];
    if (c.statut !== "libre") {
      return res.json({ success: false, error: "Seuls les créneaux libres sont modifiables." });
    }

    const startSql = toMysqlDateTime(start);
    const endSql = toMysqlDateTime(end);

    const overlap = await hasOverlap(pool, userId, startSql, endSql, creneauId);
    if (overlap) return res.json({ success:false, error:"Superposition détectée : déplacement impossible." });


    await pool.query("UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ?", [
      toMysqlDateTime(start),
      toMysqlDateTime(end),
      creneauId,
    ]);

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur move creneau:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

// Supprimer un créneau libre
app.post("/auth/api/creneaux/:id/supprimer", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const creneauId = req.params.id;

    const [rows] = await pool.query("SELECT * FROM creneaux WHERE id = ? AND user_id = ?", [
      creneauId,
      userId,
    ]);
    if (rows.length === 0) return res.json({ success: false, error: "Créneau introuvable." });

    const c = rows[0];
    if (c.statut !== "libre") {
      return res.json({ success: false, error: "Seuls les créneaux libres peuvent être supprimés." });
    }

    await pool.query("DELETE FROM creneaux WHERE id = ?", [creneauId]);
    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur delete creneau:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

// Créer directement un RDV depuis un clic vide 
app.post("/auth/api/rdv-direct-from-calendar", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { start, nom_client, email_client, tel_client, type_seance_id } = req.body;

    if (!start || !nom_client || !type_seance_id) {
      return res.json({ success: false, error: "Champs requis manquants." });
    }

    const [types] = await pool.query(
      "SELECT id, nom, duree_minutes FROM types_seance WHERE id = ? AND user_id = ?",
      [type_seance_id, userId]
    );
    if (types.length === 0) return res.json({ success: false, error: "Type de séance invalide." });

    const type = types[0];
    const duree = parseInt(type.duree_minutes, 10);
    if (!duree || isNaN(duree) || duree <= 0) {
      return res.json({ success: false, error: "Durée invalide pour ce type de séance." });
    }

    const s = new Date(start);
    const e = new Date(s.getTime() + duree * 60000);

    const startSql = toMysqlDateTime(s.toISOString());
const endSql = toMysqlDateTime(e.toISOString());

const [overlap] = await pool.query(
  `
  SELECT id
  FROM creneaux
  WHERE user_id = ?
    AND date_heure_debut < ?
    AND date_heure_fin > ?
  LIMIT 1
  `,
  [userId, endSql, startSql]
);

if (overlap.length) {
  return res.json({ success: false, error: "Chevauchement." });
}


await consumeFreeSlots(pool, userId, startSql, endSql);

    const [result] = await pool.query(
      "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES (?, ?, ?, 'reserve')",
      [userId, startSql, endSql]
    );

    const creneauId = result.insertId;

    await pool.query(
      "INSERT INTO rdv (user_id, creneau_id, nom_client, email_client, tel_client, type_seance, type_seance_id, statut, reminder_sent) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirme', 0)",
      [userId, creneauId, nom_client, email_client || null, tel_client || null, type.nom, type.id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur rdv-direct-from-calendar:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

// RDV depuis créneau existant (applique durée type + décale créneaux libres)
app.post("/auth/api/rdv-from-calendar", requireLogin, async (req, res) => {
  let conn;
  try {
    const userId = req.session.user.id;
    const { creneau_id, nom_client, email_client, tel_client, type_seance_id, commentaire } = req.body;

    if (!creneau_id || !nom_client) {
      return res.status(400).json({
        success: false,
        error: "Créneau et nom du client sont obligatoires.",
      });
    }

    if (!type_seance_id) {
      return res.status(400).json({ success: false, error: "Merci de choisir un type de séance." });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 1) Récupère le créneau (doit être libre)
    const [rows] = await conn.query(
      "SELECT * FROM creneaux WHERE id = ? AND user_id = ? AND statut = 'libre' FOR UPDATE",
      [creneau_id, userId]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.json({ success: false, error: "Ce créneau n'est plus disponible." });
    }

    const creneau = rows[0];
    const oldStart = parseMysqlDateTimeToDate(creneau.date_heure_debut);
    const oldEnd = parseMysqlDateTimeToDate(creneau.date_heure_fin);

    // 2) Récupère le type de séance (durée + nom)
    const [types] = await conn.query(
      "SELECT id, nom, duree_minutes FROM types_seance WHERE id = ? AND user_id = ?",
      [type_seance_id, userId]
    );

    if (types.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: "Type de séance invalide." });
    }

    const type = types[0];
    const dureeMinutes = parseInt(type.duree_minutes || 0, 10);

    if (!dureeMinutes || isNaN(dureeMinutes) || dureeMinutes <= 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: "Durée du type de séance invalide." });
    }

    const desiredEnd = new Date(oldStart.getTime() + dureeMinutes * 60000);

    const startSql = toMysqlDateTime(oldStart.toISOString());
    const endSql = toMysqlDateTime(desiredEnd.toISOString());

    // Fin de journée enregistrée
    const dayStr = oldStart.toISOString().slice(0, 10); 
    const [jrows] = await conn.query(
      "SELECT end_time FROM journees WHERE user_id = ? AND date_jour = ? LIMIT 1",
      [userId, dayStr]
    );
    let dayEnd = null;
    if (jrows.length > 0) {
      const endTime = jrows[0].end_time; // ex "20:00:00"
      dayEnd = new Date(`${dayStr}T${String(endTime).slice(0,5)}:00`);
    }

    // Prochaine barrière non-libre (RDV/bloqué)
    const [nextHard] = await conn.query(
      `
      SELECT date_heure_debut
      FROM creneaux
      WHERE user_id = ?
        AND statut <> 'libre'
        AND date_heure_debut >= ?
      ORDER BY date_heure_debut ASC
      LIMIT 1
      `,
      [userId, creneau.date_heure_debut]
    );

    const barrierStart = nextHard.length ? parseMysqlDateTimeToDate(nextHard[0].date_heure_debut) : null;

    // Limite effective = min(barrière, fin journée) si elles existent
    let hardLimit = null;
    if (barrierStart && dayEnd) hardLimit = barrierStart < dayEnd ? barrierStart : dayEnd;
    else hardLimit = barrierStart || dayEnd;

    if (hardLimit && desiredEnd > hardLimit) {
      await conn.rollback();
      return res.json({ success:false, error:"Ce créneau ne permet pas la durée de cette séance avant la fin de journée / prochain RDV." });
    }



    // 3) Conflit avec des créneaux non-libres (RDV/bloqués)
    const [hardConflicts] = await conn.query(
      `SELECT id, statut, date_heure_debut, date_heure_fin
       FROM creneaux
       WHERE user_id = ?
         AND id <> ?
         AND statut <> 'libre'
         AND (date_heure_debut < ? AND date_heure_fin > ?)
       LIMIT 1`,
      [userId, creneau.id, endSql, startSql]
    );

    if (hardConflicts.length > 0) {
      await conn.rollback();
      return res.json({
        success: false,
        error:
          "Impossible : la durée de la séance chevauche un RDV ou une période bloquée. Choisis un autre créneau.",
      });
    }
    
    const barrierStartSql = barrierStart ? toMysqlDateTime(barrierStart.toISOString()) : null;

    // 4) Créneaux libres suivants (on va les décaler si besoin)
    let freeSlotsSql = `
    SELECT id, date_heure_debut, date_heure_fin
    FROM creneaux
    WHERE user_id = ?
      AND statut = 'libre'
      AND id <> ?
      AND date_heure_debut >= ?
  `;
  const params = [userId, creneau.id, creneau.date_heure_debut];

  if (barrierStart) {
    freeSlotsSql += " AND date_heure_debut < ? ";
    params.push(toMysqlDateTime(barrierStart.toISOString()));
  }

  freeSlotsSql += `
    ORDER BY date_heure_debut ASC
    FOR UPDATE
  `;

  const [freeSlots] = await conn.query(freeSlotsSql, params);



    // 5) Update créneau courant -> réservé + nouvelle fin
    await conn.query("UPDATE creneaux SET date_heure_fin = ?, statut = 'reserve' WHERE id = ?", [
      endSql,
      creneau.id,
    ]);

    // 6) Décalage auto des slots libres 
    let cursor = desiredEnd;
    let prevOldEnd = oldEnd;

    for (const slot of freeSlots) {
      const slotOldStart = parseMysqlDateTimeToDate(slot.date_heure_debut);
      const slotOldEnd = parseMysqlDateTimeToDate(slot.date_heure_fin);

      const gapMs = Math.max(0, slotOldStart.getTime() - prevOldEnd.getTime());
      const durMs = Math.max(5 * 60 * 1000, slotOldEnd.getTime() - slotOldStart.getTime());

      const newStart = new Date(cursor.getTime() + gapMs);
      const newEnd = new Date(newStart.getTime() + durMs);

      if (hardLimit && newEnd > hardLimit) {
        const idsToDelete = [slot.id, ...freeSlots.slice(freeSlots.indexOf(slot) + 1).map(s => s.id)];
        if (idsToDelete.length) {
          await conn.query(
            `DELETE FROM creneaux WHERE user_id = ? AND statut = 'libre' AND id IN (?)`,
            [userId, idsToDelete]
          );
        }
        break;
      }

      const newStartSql = toMysqlDateTime(newStart.toISOString());
      const newEndSql = toMysqlDateTime(newEnd.toISOString());

      // Si le slot est déjà "assez loin", on ne le bouge pas et on avance le curseur
      if (slotOldStart.getTime() >= newStart.getTime() && slotOldEnd.getTime() >= newEnd.getTime()) {
        cursor = slotOldEnd;
        prevOldEnd = slotOldEnd;
        continue;
      }

      // Si le nouveau slot chevauche un RDV/bloqué => on refuse
      const [blocking] = await conn.query(
        `SELECT id, statut
         FROM creneaux
         WHERE user_id = ?
           AND statut <> 'libre'
           AND id <> ?
           AND (date_heure_debut < ? AND date_heure_fin > ?)
         LIMIT 1`,
        [userId, slot.id, newEndSql, newStartSql]
      );

      if (blocking.length > 0) {
        await conn.rollback();
        return res.json({
          success: false,
          error:
            "Impossible de décaler automatiquement les créneaux libres car un RDV (ou une période bloquée) empêche le décalage. Choisis un autre créneau ou décale manuellement.",
        });
      }

      await conn.query("UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ?", [
        newStartSql,
        newEndSql,
        slot.id,
      ]);

      cursor = newEnd;
      prevOldEnd = slotOldEnd;
    }

    // 7) Création du RDV
    await conn.query(
      "INSERT INTO rdv (user_id, creneau_id, nom_client, email_client, tel_client, type_seance, type_seance_id, commentaire, statut, reminder_sent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirme', 0)",
      [userId, creneau.id, nom_client, email_client || null, tel_client || null, type.nom, type.id, commentaire || null]
    );

    await conn.commit();
    return res.json({ success: true });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {}
    }
    console.error("Erreur rdv-from-calendar :", err);
    return res.status(500).json({ success: false, error: "Erreur serveur lors de la création du RDV." });
  } finally {
    if (conn) conn.release();
  }
});

// Annuler RDV (suppression complète + restauration créneau libre avec bonne durée)
app.post("/auth/api/rdv/:id/annuler", requireLogin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const userId = req.session.user.id;
    const rdvId = req.params.id;

    // On récupère RDV + créneau + durée du type (si dispo)
    const [rows] = await conn.query(
      `
      SELECT 
        r.id, r.creneau_id, r.type_seance_id,
        c.date_heure_debut AS c_start, c.date_heure_fin AS c_end,
        ts.duree_minutes
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      LEFT JOIN types_seance ts ON ts.id = r.type_seance_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.json({ success: false, error: "RDV introuvable." });
    }

    const rdv = rows[0];

    // Durée à restaurer 
    const startDate = parseMysqlDateTimeToDate(rdv.c_start);
    const endDateCurrent = parseMysqlDateTimeToDate(rdv.c_end);

    let durMs;
    const dmin = parseInt(rdv.duree_minutes, 10);
    if (dmin && !isNaN(dmin) && dmin > 0) {
      durMs = dmin * 60 * 1000;
    } else {
      durMs = Math.max(5 * 60 * 1000, endDateCurrent.getTime() - startDate.getTime());
    }

    const restoredEnd = new Date(startDate.getTime() + durMs);
    const restoredEndSql = toMysqlDateTime(restoredEnd.toISOString());

    // 1) On repasse le créneau en libre + on restaure une fin cohérente
    await conn.query(
      "UPDATE creneaux SET statut = 'libre', date_heure_fin = ? WHERE id = ? AND user_id = ?",
      [restoredEndSql, rdv.creneau_id, userId]
    );

    // 2) On supprime le RDV (=> plus d'annulé en base)
    await conn.query("DELETE FROM rdv WHERE id = ? AND user_id = ?", [rdvId, userId]);

    await conn.commit();
    return res.json({ success: true });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (e) {}
    }
    console.error("Erreur annuler RDV:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  } finally {
    if (conn) conn.release();
  }
});


// Déplacer un RDV 
app.post("/auth/api/rdv/:id/move", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;
    const { start } = req.body;

    if (!start) return res.json({ success: false, error: "Date de début manquante." });

    // RDV + créneau associé 
    const [rows] = await pool.query(
      `
      SELECT r.id, r.creneau_id,
             c.date_heure_debut, c.date_heure_fin
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.user_id = ? AND c.user_id = ?
      LIMIT 1
      `,
      [rdvId, userId, userId]
    );

    if (rows.length === 0) return res.json({ success: false, error: "RDV introuvable." });

    const rdv = rows[0];

    const oldStart = rdv.date_heure_debut instanceof Date ? rdv.date_heure_debut : new Date(rdv.date_heure_debut);
    const oldEnd = rdv.date_heure_fin instanceof Date ? rdv.date_heure_fin : new Date(rdv.date_heure_fin);
    const durationMs = oldEnd.getTime() - oldStart.getTime();
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return res.json({ success: false, error: "Durée RDV invalide." });
    }

    const newStart = new Date(start);
    const newEnd = new Date(newStart.getTime() + durationMs);

    const startSql = toMysqlDateTime(newStart.toISOString());
    const endSql = toMysqlDateTime(newEnd.toISOString());

    const [overlap] = await pool.query(
      `
      SELECT id, statut
      FROM creneaux
      WHERE user_id = ?
        AND id <> ?
        AND date_heure_debut < ?
        AND date_heure_fin > ?
      LIMIT 1
      `,
      [userId, rdv.creneau_id, endSql, startSql]
    );

    if (overlap.length) {
      return res.json({ success: false, error: "Chevauchement." });
    }

    await consumeFreeSlots(pool, userId, startSql, endSql, rdv.creneau_id);

    await pool.query(
      "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ? AND user_id = ?",
      [startSql, endSql, rdv.creneau_id, userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur move RDV:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});


// Générer une journée de créneaux
app.post("/auth/api/generate-day-slots", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date, startTime, endTime, slotMinutes, breakMinutes } = req.body;

    if (!date || !startTime || !endTime || !slotMinutes) {
      return res.json({ success: false, error: "Paramètres manquants." });
    }

    const slotM = parseInt(slotMinutes, 10);
    const breakM = parseInt(breakMinutes || 0, 10);

    if (isNaN(slotM) || slotM <= 0) return res.json({ success: false, error: "Durée créneau invalide." });
    if (isNaN(breakM) || breakM < 0) return res.json({ success: false, error: "Pause invalide." });

    let cursor = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);

    if (cursor >= end) return res.json({ success: false, error: "Heures invalides." });

    const inserts = [];

    while (cursor < end) {
      const slotStart = new Date(cursor.getTime());
      const slotEnd = new Date(slotStart.getTime() + slotM * 60000);

      if (slotEnd > end) break;
      const sSql = toMysqlDateTime(slotStart.toISOString());
      const eSql = toMysqlDateTime(slotEnd.toISOString());

      const overlap = await hasOverlap(pool, userId, sSql, eSql);
      if (!overlap) {
        inserts.push([userId, sSql, eSql, "libre"]);
      }

      cursor = new Date(slotEnd.getTime() + breakM * 60000);
    }

    if (inserts.length === 0) return res.json({ success: false, error: "Aucun créneau généré." });

    await pool.query("INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES ?", [inserts]);
    await pool.query(
      `
      INSERT INTO journees (user_id, date_jour, start_time, end_time)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time)
      `,
      [userId, date, startTime, endTime]
    );



    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur generate-day-slots:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

// Bloquer une journée
app.post("/auth/api/block-day", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date, commentaire } = req.body;

    if (!date) return res.json({ success: false, error: "Date manquante." });

    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59`);

    const startSql = toMysqlDateTime(start.toISOString());
    const endSql = toMysqlDateTime(end.toISOString());

    const overlap = await hasOverlap(pool, userId, startSql, endSql);
    if (overlap) return res.json({ success:false, error:"Superposition : impossible de bloquer la journée (il existe déjà des créneaux/RDV)." });

    await pool.query(
      "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut, commentaire) VALUES (?, ?, ?, 'bloque', ?)",
      [userId, startSql, endSql, commentaire ? String(commentaire).slice(0,255) : null]
    );


    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur block-day:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

app.get("/auth/dupliquer-journee", requireLogin, async (req, res) => {
  res.render("dupliquer-journee", { user: req.session.user });
});

app.post("/auth/dupliquer-journee", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date_source, date_cible, overwrite } = req.body;

    if (!date_source || !date_cible) return res.redirect("/auth/dupliquer-journee");
    if (date_source === date_cible) return res.redirect("/auth/dupliquer-journee");

    // Récupère les créneaux libres de la date source
    const [src] = await pool.query(
      `
      SELECT date_heure_debut, date_heure_fin
      FROM creneaux
      WHERE user_id = ?
        AND statut = 'libre'
        AND DATE(date_heure_debut) = ?
      ORDER BY date_heure_debut ASC
      `,
      [userId, date_source]
    );

    if (!src.length) return res.redirect("/auth/dupliquer-journee");

    // Option : écraser les libres existants sur la date cible
    if (overwrite === "1") {
      await pool.query(
        `
        DELETE FROM creneaux
        WHERE user_id = ?
          AND statut = 'libre'
          AND DATE(date_heure_debut) = ?
        `,
        [userId, date_cible]
      );
    } else {
      // Sinon, si déjà des créneaux sur la cible, on bloque (évite doublons)
      const [existing] = await pool.query(
        `
        SELECT id
        FROM creneaux
        WHERE user_id = ?
          AND DATE(date_heure_debut) = ?
        LIMIT 1
        `,
        [userId, date_cible]
      );
      if (existing.length) return res.redirect("/auth/dupliquer-journee");
    }

    // Insert des créneaux copiés en gardant les heures
    // (on reconstruit date_cible + time(debut/fin))
    for (const c of src) {
      const debut = new Date(c.date_heure_debut);
      const fin = new Date(c.date_heure_fin);

      const hh1 = String(debut.getHours()).padStart(2, "0");
      const mm1 = String(debut.getMinutes()).padStart(2, "0");
      const hh2 = String(fin.getHours()).padStart(2, "0");
      const mm2 = String(fin.getMinutes()).padStart(2, "0");

      const newStart = `${date_cible} ${hh1}:${mm1}:00`;
      const newEnd = `${date_cible} ${hh2}:${mm2}:00`;

      await pool.query(
        `
        INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut)
        VALUES (?, ?, ?, 'libre')
        `,
        [userId, newStart, newEnd]
      );
    }

    res.redirect("/auth/calendar");
  } catch (err) {
    console.error("Erreur duplication journée:", err);
    res.redirect("/auth/dupliquer-journee");
  }
});

// ===================== PAGES CLIENT (PUBLIC) =====================

// Liste des praticiens
app.get("/rdv", async (req, res) => {
  try {
    const [praticiens] = await pool.query(
      "SELECT id, nom, email, couleur_agenda FROM users WHERE role = 'praticien' ORDER BY nom ASC"
    );

    res.render("liste-praticiens", { praticiens });
  } catch (err) {
    console.error("Erreur chargement praticiens :", err);
    res.status(500).send("Erreur serveur");
  }
});

// Liste des créneaux disponibles pour un praticien
app.get("/rdv/:userId", async (req, res) => {
  try {
    res.locals.publicPage = true;

    const userId = Number(req.params.userId);
    const [proRows] = await pool.query(
      "SELECT id, nom, email FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const pro = proRows.length ? proRows[0] : null;

    if (!userId) return res.status(404).send("Praticien introuvable.");

    const [praticiens] = await pool.query("SELECT id, nom FROM users WHERE id = ?", [userId]);
    if (praticiens.length === 0) return res.status(404).send("Praticien introuvable.");

    const praticien = praticiens[0];

    const selectedTypeId = req.query.type ? Number(req.query.type) : null;  
    const [typesSeance] = await pool.query(
      "SELECT id, nom, duree_minutes, couleur, description FROM types_seance WHERE user_id = ? ORDER BY nom ASC",
      [userId]
    );
    const [profileRows] = await pool.query(
      "SELECT * FROM pro_profile WHERE user_id = ? LIMIT 1",
      [userId]
    );
    const profile = profileRows.length ? profileRows[0] : null;

    
    if (!selectedTypeId) {
      return res.render("prendre-rdv", {
        praticien,
        typesSeance,
        profile,
        selectedTypeId: null,
        creneaux: [],
        success: req.query.success === "1",
      });
    }

    const selectedType = typesSeance.find(t => String(t.id) === String(selectedTypeId));
    if (!selectedType) {
      return res.render("prendre-rdv", {
        praticien,
        typesSeance,
        profile,
        selectedTypeId: null,
        creneaux: [],
        success: req.query.success === "1",
      });
    }

    const dureeMinutes = parseInt(selectedType.duree_minutes, 10);


    const [creneauxRows] = await pool.query(
      `
      SELECT c.*
      FROM creneaux c
      WHERE c.user_id = ?
        AND c.statut = 'libre'
        AND c.date_heure_debut > NOW()
        AND NOT EXISTS (
          SELECT 1 FROM creneaux b
          WHERE b.user_id = c.user_id
            AND b.statut = 'bloque'
            AND b.date_heure_debut < DATE_ADD(c.date_heure_debut, INTERVAL ? MINUTE)
            AND b.date_heure_fin > c.date_heure_debut
        )
        AND NOT EXISTS (
          SELECT 1 FROM creneaux x
          WHERE x.user_id = c.user_id
            AND x.statut <> 'libre'
            AND x.date_heure_debut < DATE_ADD(c.date_heure_debut, INTERVAL ? MINUTE)
            AND x.date_heure_fin > c.date_heure_debut
        )
      ORDER BY c.date_heure_debut ASC
      LIMIT 200
      `,
      [userId, dureeMinutes, dureeMinutes]
    );

    const allSlots = creneauxRows
      .map(c => ({
        id: c.id,
        start: parseMysqlDateTimeToDate(c.date_heure_debut).getTime(),
        end: parseMysqlDateTimeToDate(c.date_heure_fin).getTime(),
        raw: c
      }))
      .sort((a,b) => a.start - b.start);

    function canAutoShiftFreeSlots({ chosenOldEnd, desiredEnd, freeSlots, barrierStart }) {
      let cursor = new Date(desiredEnd.getTime());
      let prevOldEnd = new Date(chosenOldEnd.getTime());

      for (const slot of freeSlots) {
        const slotOldStart = new Date(slot.start);
        const slotOldEnd = new Date(slot.end);

        if (barrierStart && slotOldStart.getTime() >= barrierStart.getTime()) break;

        const gapMs = Math.max(0, slotOldStart.getTime() - prevOldEnd.getTime());
        const durMs = Math.max(5 * 60 * 1000, slotOldEnd.getTime() - slotOldStart.getTime());

        const newStart = new Date(cursor.getTime() + gapMs);
        const newEnd = new Date(newStart.getTime() + durMs);

        if (barrierStart && newEnd.getTime() > barrierStart.getTime()) return false;

        cursor = newEnd;
        prevOldEnd = slotOldEnd;
      }

      return true;
    }

    const creneauxRowsFinal = [];

    for (const chosen of allSlots) {
      const start = new Date(chosen.start);
      const oldEnd = new Date(chosen.end);
      const desiredEnd = new Date(start.getTime() + dureeMinutes * 60000);

      // Si déjà assez long => OK
      if (desiredEnd.getTime() <= oldEnd.getTime()) {
        creneauxRowsFinal.push(chosen.raw);
        continue;
      }

      const [barrier] = await pool.query(
        `
        SELECT date_heure_debut AS barrier_start
        FROM creneaux
        WHERE user_id = ?
          AND statut <> 'libre'
          AND date_heure_debut >= ?
        ORDER BY date_heure_debut ASC
        LIMIT 1
        `,
        [userId, toMysqlDateTime(oldEnd.toISOString())]
      );
      const barrierStart = barrier.length ? parseMysqlDateTimeToDate(barrier[0].barrier_start) : null;

      const freeSlots = allSlots.filter(s =>
        s.start >= oldEnd.getTime() &&
        (!barrierStart || s.start < barrierStart.getTime())
      );

      const ok = canAutoShiftFreeSlots({
        chosenOldEnd: oldEnd,
        desiredEnd,
        freeSlots,
        barrierStart
      });

      if (ok) creneauxRowsFinal.push(chosen.raw);
    }
  
    const creneaux = creneauxRowsFinal.map((c) => {
    const d1 = parseMysqlDateTimeToDate(c.date_heure_debut);
    const d2 = new Date(d1.getTime() + dureeMinutes * 60000);
    return {
      ...c,
      date_heure_debut: d1,
      date_heure_fin: parseMysqlDateTimeToDate(c.date_heure_fin),
      display_fin: d2,
    };
  });

    
    return res.render("prendre-rdv", {
      praticien,
      typesSeance,
      profile,
      selectedTypeId,
      creneaux,
      success: req.query.success === "1",
    });
  } catch (err) {
    console.error("Erreur page rdv:", err);
    return res.status(500).send("Erreur serveur.");
  }
});

// Formulaire de réservation pour un créneau
app.get("/rdv/reserver/:id", async (req, res) => {
  try {
    res.locals.publicPage = true;
    const selectedTypeId = req.query.type ? Number(req.query.type) : null;

    const creneauId = Number(req.params.id);
    if (!creneauId) return res.status(404).send("Créneau introuvable.");

    const [rows] = await pool.query(
      `SELECT c.*
       FROM creneaux c
       WHERE c.id = ?
         AND c.statut = 'libre'
         AND c.date_heure_debut > NOW()
         AND NOT EXISTS (
           SELECT 1 FROM creneaux b
           WHERE b.user_id = c.user_id
             AND b.statut = 'bloque'
             AND b.date_heure_debut < c.date_heure_fin
             AND b.date_heure_fin > c.date_heure_debut
         )
       LIMIT 1`,
      [creneauId]
    );

    if (rows.length === 0) {
      return res.status(404).send("Ce créneau n'est plus disponible.");
    }

    const creneau = {
      ...rows[0],
      date_heure_debut: parseMysqlDateTimeToDate(rows[0].date_heure_debut),
      date_heure_fin: parseMysqlDateTimeToDate(rows[0].date_heure_fin),
    };

    const [typesSeance] = await pool.query(
      "SELECT id, nom, duree_minutes, couleur FROM types_seance WHERE user_id = ? ORDER BY nom ASC",
      [creneau.user_id]
    );

    let displayFin = creneau.date_heure_fin; // fallback
    if (selectedTypeId) {
      const t = typesSeance.find(x => String(x.id) === String(selectedTypeId));
      if (t && t.duree_minutes) {
        displayFin = new Date(creneau.date_heure_debut.getTime() + parseInt(t.duree_minutes, 10) * 60000);
      }
    }

    return res.render("formulaire-rdv", { creneau, typesSeance, selectedTypeId, displayFin, error: null });
  } catch (err) {
    console.error("Erreur formulaire rdv:", err);
    return res.status(500).send("Erreur serveur.");
  }
});

// Réserver (POST)
app.post("/rdv/reserver", async (req, res) => {
  let conn;
  try {
    res.locals.publicPage = true;

    const { creneau_id, nom_client, email_client, tel_client, type_seance_id, commentaire } = req.body;

    if (!creneau_id || !nom_client || !type_seance_id || !email_client || !tel_client) {
      return res.status(400).send("Champs requis manquants.");
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Lock créneau
    const [rows] = await conn.query(
      "SELECT * FROM creneaux WHERE id = ? AND statut = 'libre' AND date_heure_debut > NOW() FOR UPDATE",
      [creneau_id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).send("Ce créneau n'est plus disponible.");
    }

    const creneau = rows[0];
    const userId = creneau.user_id;

    // Type séance
    const [types] = await conn.query(
      "SELECT id, nom, duree_minutes FROM types_seance WHERE id = ? AND user_id = ?",
      [type_seance_id, userId]
    );
    if (types.length === 0) {
      await conn.rollback();
      return res.status(400).send("Type de séance invalide.");
    }

    const type = types[0];
    const dureeMinutes = parseInt(type.duree_minutes, 10);
    if (!dureeMinutes || isNaN(dureeMinutes) || dureeMinutes <= 0) {
      await conn.rollback();
      return res.status(400).send("Durée invalide.");
    }

    const start = parseMysqlDateTimeToDate(creneau.date_heure_debut);
    const oldEnd = parseMysqlDateTimeToDate(creneau.date_heure_fin);
    const desiredEnd = new Date(start.getTime() + dureeMinutes * 60000);

    const startSql = toMysqlDateTime(start.toISOString());
    const endSql = toMysqlDateTime(desiredEnd.toISOString());
    const hardLimit = false;
    
    // Conflit avec non-libres (RDV/bloque)
    const [hardConflicts] = await conn.query(
      `SELECT id, statut
       FROM creneaux
       WHERE user_id = ?
         AND id <> ?
         AND statut <> 'libre'
         AND (date_heure_debut < ? AND date_heure_fin > ?)
       LIMIT 1`,
      [userId, creneau.id, endSql, startSql]
    );
    if (hardConflicts.length > 0) {
      await conn.rollback();
      return res.status(400).send("Ce créneau ne permet pas la durée demandée. Merci d'en choisir un autre.");
    }

    // Si la séance est plus courte que le créneau libre initial, on garde le reste en libre
    if (desiredEnd.getTime() < oldEnd.getTime()) {
      await conn.query(
        "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES (?, ?, ?, 'libre')",
        [userId, endSql, toMysqlDateTime(oldEnd.toISOString())]
      );
    }

    // Si la durée dépasse la fin du créneau initial, on décale automatiquement les créneaux libres suivants
    if (desiredEnd.getTime() > oldEnd.getTime()) {
      // On récupère les slots libres après la fin initiale, jusqu'au prochain "non-libre"
      const [barrier] = await conn.query(
        `
        SELECT date_heure_debut AS barrier_start
        FROM creneaux
        WHERE user_id = ?
          AND statut <> 'libre'
          AND date_heure_debut >= ?
        ORDER BY date_heure_debut ASC
        LIMIT 1
        FOR UPDATE
        `,
        [userId, toMysqlDateTime(oldEnd.toISOString())]
      );

      const barrierStart = barrier.length ? parseMysqlDateTimeToDate(barrier[0].barrier_start) : null;

      let freeSlotsSql = `
        SELECT id, date_heure_debut, date_heure_fin
        FROM creneaux
        WHERE user_id = ?
          AND statut = 'libre'
          AND date_heure_debut >= ?
      `;
      const params = [userId, toMysqlDateTime(desiredEnd.toISOString())];

      if (barrierStart) {
        freeSlotsSql += " AND date_heure_debut < ? ";
        params.push(toMysqlDateTime(barrierStart.toISOString()));
      }

      freeSlotsSql += `
        ORDER BY date_heure_debut ASC
        FOR UPDATE
      `;

      const [freeSlots] = await conn.query(freeSlotsSql, params);

      // Décalage auto des slots libres en conservant gaps & durées
      let cursor = desiredEnd;
      let prevOldEnd = oldEnd;

      for (const slot of freeSlots) {
        const slotOldStart = parseMysqlDateTimeToDate(slot.date_heure_debut);
        const slotOldEnd = parseMysqlDateTimeToDate(slot.date_heure_fin);

        const gapMs = Math.max(0, slotOldStart.getTime() - prevOldEnd.getTime());
        const durMs = Math.max(5 * 60 * 1000, slotOldEnd.getTime() - slotOldStart.getTime());

        const newStart = new Date(cursor.getTime() + gapMs);
        const newEnd = new Date(newStart.getTime() + durMs);

        const newStartSql = toMysqlDateTime(newStart.toISOString());
        const newEndSql = toMysqlDateTime(newEnd.toISOString());

        // Si le nouveau slot chevauche un RDV/bloqué => on refuse
        const [blocking] = await conn.query(
          `
          SELECT id, statut
          FROM creneaux
          WHERE user_id = ?
            AND statut <> 'libre'
            AND date_heure_debut < ?
            AND date_heure_fin > ?
          LIMIT 1
          `,
          [userId, newEndSql, newStartSql]
        );

        if (blocking.length) {
          await conn.query("DELETE FROM creneaux WHERE id = ? AND user_id = ?", [slot.id, userId]);
          prevOldEnd = slotOldEnd;
          continue;
        }

        await conn.query(
          "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ? AND user_id = ?",
          [newStartSql, newEndSql, slot.id, userId]
        );

        cursor = newEnd;
        prevOldEnd = slotOldEnd;
      }
    }


    // Le créneau choisi devient réservé sur [start, desiredEnd]
    await conn.query(
      "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ?, statut = 'reserve' WHERE id = ? AND user_id = ?",
      [startSql, endSql, creneau.id, userId]
    );

    // Supprimer tous les créneaux libres qui chevauchent [start, desiredEnd] (sécurité anti-chevauchement)
    await conn.query(
      `
      DELETE FROM creneaux
      WHERE user_id = ?
        AND statut = 'libre'
        AND date_heure_debut < ?
        AND date_heure_fin > ?
      `,
      [userId, endSql, startSql]
    );

    // Insérer RDV
    await conn.query(
      "INSERT INTO rdv (user_id, creneau_id, nom_client, email_client, tel_client, type_seance, type_seance_id, commentaire, statut, reminder_sent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirme', 0)",
      [userId, creneau.id, nom_client, email_client || null, tel_client || null, type.nom, type.id, commentaire || null]
    );

    await conn.commit();

    // Mail au praticien
    const [pr] = await pool.query("SELECT email, nom FROM users WHERE id = ?", [userId]);
    if (pr.length && pr[0].email) {
      await sendMailSafe({
        to: pr[0].email,
        subject: "Nouveau rendez-vous réservé",
        text:
          `Un nouveau RDV a été réservé.\n\n` +
          `Client: ${nom_client}\n` +
          `Email: ${email_client || "-"}\n` +
          `Téléphone: ${tel_client || "-"}\n` +
          `Type: ${type.nom}\n` +
          `Début: ${start.toLocaleString("fr-FR")}\n` +
          `Fin: ${desiredEnd.toLocaleString("fr-FR")}\n` +
          (commentaire ? `\nCommentaire: ${commentaire}\n` : ""),
      });
    }


    // Redirect vers la liste
    return res.redirect(`/rdv/${userId}?type=${type.id}&success=1`);
  } catch (err) {
    if (conn) { 
      try {
        await conn.rollback();
      } catch (e) {}
    }
    console.error("Erreur reserver rdv:", err);
    return res.status(500).send("Erreur serveur.");
  } finally {
    if (conn) conn.release();
  }
});


app.use((req, res) => {
  const accept = req.headers.accept || "";
  if (accept.includes("application/json")) {
    return res.status(404).json({ success: false, error: "Not Found" });
  }
  return res.status(404).render("404", { title: "Page introuvable" });
});

// ===================== SERVER =====================
app.listen(PORT, "0.0.0.0", () => console.log("Server lancé sur le port", PORT))
