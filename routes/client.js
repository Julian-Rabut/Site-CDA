"use strict";

const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");
const pool = require("../config/db");
const { requireClientLogin } = require("../middlewares/auth");
const { sanitizeNextUrl } = require("../utils/urls");
const { toMysqlDateTime, parseMysqlDateTimeToDate } = require("../utils/dates");
const { sendMailSafe } = require("../services/mailService");

const router = express.Router();

router.get("/login", (req, res) => {
  res.locals.publicPage = true;
  res.render("client-login", {
    error: null,
    next: sanitizeNextUrl(req.query.next || "/rdv"),
  });
});

router.post(
  "/login",
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Email invalide.")
      .normalizeEmail(),

    body("mot_de_passe")
      .notEmpty()
      .withMessage("Mot de passe requis."),
  ],
  async (req, res) => {
    try {
      res.locals.publicPage = true;

      const errors = validationResult(req);
      const nextUrl = sanitizeNextUrl(req.body.next || "/rdv");

      if (!errors.isEmpty()) {
        return res.render("client-login", {
          error: errors.array()[0].msg,
          next: nextUrl,
        });
      }

      const { email, mot_de_passe } = req.body;
      const emailClean = email.trim().toLowerCase();

      const [rows] = await pool.query(
        "SELECT * FROM clients WHERE email = ? LIMIT 1",
        [emailClean]
      );

      if (rows.length === 0) {
        return res.render("client-login", {
          error: "Identifiants invalides.",
          next: nextUrl,
        });
      }

      const client = rows[0];
      const ok = await bcrypt.compare(mot_de_passe, client.mot_de_passe);

      if (!ok) {
        return res.render("client-login", {
          error: "Identifiants invalides.",
          next: nextUrl,
        });
      }

      req.session.client = {
        id: client.id,
        nom: client.nom,
        email: client.email,
        telephone: client.telephone,
      };

      return res.redirect(nextUrl || "/rdv");
    } catch (err) {
      console.error("Erreur login client :", err);
      return res.render("client-login", {
        error: "Erreur serveur.",
        next: sanitizeNextUrl(req.body.next || "/rdv"),
      });
    }
  }
);

router.get("/register", (req, res) => {
  res.locals.publicPage = true;
  res.render("client-register", {
    error: null,
    next: sanitizeNextUrl(req.query.next || "/rdv"),
    formData: {
      nom: "",
      email: "",
      telephone: "",
    },
  });
});
router.post(
  "/register",

  [
    body("nom")
      .trim()
      .notEmpty()
      .withMessage("Le nom est obligatoire."),

    body("email")
      .trim()
      .isEmail()
      .withMessage("Email invalide.")
      .normalizeEmail(),

    body("telephone")
      .trim()
      .notEmpty()
      .withMessage("Le téléphone est obligatoire.")
      .isLength({ min: 8, max: 20 })
      .withMessage("Téléphone invalide."),

    body("mot_de_passe")
      .isLength({ min: 8 })
      .withMessage("Le mot de passe doit contenir au moins 8 caractères."),

    body("mot_de_passe_confirm")
      .custom((value, { req }) => value === req.body.mot_de_passe)
      .withMessage("Les mots de passe ne correspondent pas.")
  ],

  async (req, res) => {
    try {
      res.locals.publicPage = true;

      const errors = validationResult(req);
      const nextUrl = sanitizeNextUrl(req.body.next || "/rdv");

      if (!errors.isEmpty()) {
        return res.render("client-register", {
          error: errors.array()[0].msg,
          next: nextUrl,
          formData: {
            nom: req.body.nom || "",
            email: req.body.email || "",
            telephone: req.body.telephone || "",
          },
        });
      }

      const {
        nom,
        email,
        telephone,
        mot_de_passe
      } = req.body;

      const emailClean = email.trim().toLowerCase();

      const [exists] = await pool.query(
        "SELECT id FROM clients WHERE email = ? LIMIT 1",
        [emailClean]
      );

      if (exists.length > 0) {
        return res.render("client-register", {
          error: "Un compte client existe déjà avec cet email.",
          next: nextUrl,

          formData: {
            nom,
            email,
            telephone
          }
        });
      }

      const hash = await bcrypt.hash(
        mot_de_passe,
        10
      );

      const [result] = await pool.query(
        `
        INSERT INTO clients
        (nom,email,telephone,mot_de_passe)
        VALUES (?,?,?,?)
        `,
        [
          nom.trim(),
          emailClean,
          telephone.trim(),
          hash
        ]
      );

      req.session.client = {
        id: result.insertId,
        nom: nom.trim(),
        email: emailClean,
        telephone: telephone.trim(),
      };

      return res.redirect(
        nextUrl || "/rdv"
      );

    } catch (err) {

      console.error(
        "Erreur register client :",
        err
      );

      return res.render(
        "client-register",
        {
          error: "Erreur serveur.",

          next: sanitizeNextUrl(
            req.body.next || "/rdv"
          ),

          formData: {
            nom: req.body.nom || "",
            email: req.body.email || "",
            telephone: req.body.telephone || "",
          }
        }
      );
    }
  }
);

router.get("/mot-de-passe-oublie", (req, res) => {
  res.locals.publicPage = true;
  res.render("client-forgot-password", {
    error: null,
    success: null,
  });
});

router.post(
  "/mot-de-passe-oublie",
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Email invalide.")
      .normalizeEmail(),
  ],
  async (req, res) => {
  try {
    res.locals.publicPage = true;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.render("client-forgot-password", {
        error: errors.array()[0].msg,
        success: null,
      });
    }
    const { email } = req.body;

    if (!email) {
      return res.render("client-forgot-password", {
        error: "Merci de renseigner votre email.",
        success: null,
      });
    }

    const emailClean = email.trim().toLowerCase();

    const [rows] = await pool.query(
      "SELECT id, nom, email FROM clients WHERE email = ? LIMIT 1",
      [emailClean]
    );

    if (rows.length > 0) {
      const client = rows[0];
      const token = crypto.randomBytes(32).toString("hex");

      await pool.query(
        `
        UPDATE clients
        SET reset_token = ?, reset_token_expire = DATE_ADD(NOW(), INTERVAL 1 HOUR)
        WHERE id = ?
        `,
        [token, client.id]
      );

      const resetLink = `${req.protocol}://${req.get("host")}/client/reset-password/${token}`;

      await sendMailSafe({
        to: client.email,
        subject: "Réinitialisation de votre mot de passe",
        text:
          `Bonjour ${client.nom},\n\n` +
          `Vous avez demandé la réinitialisation de votre mot de passe.\n\n` +
          `Cliquez sur ce lien pour choisir un nouveau mot de passe :\n` +
          `${resetLink}\n\n` +
          `Ce lien est valable pendant 1 heure.\n\n` +
          `Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message.`,
      });
    }

    return res.render("client-forgot-password", {
      error: null,
      success: "Si un compte existe avec cet email, un lien de réinitialisation vient d’être envoyé.",
    });
  } catch (err) {
    console.error("Erreur mot de passe oublié client :", err);
    return res.render("client-forgot-password", {
      error: "Erreur serveur.",
      success: null,
    });
  }
});

router.get("/reset-password/:token", async (req, res) => {
  try {
    res.locals.publicPage = true;
    const token = req.params.token;

    const [rows] = await pool.query(
      `
      SELECT id
      FROM clients
      WHERE reset_token = ?
        AND reset_token_expire IS NOT NULL
        AND reset_token_expire >= NOW()
      LIMIT 1
      `,
      [token]
    );

    if (rows.length === 0) {
      return res.render("client-reset-password", {
        error: "Lien invalide ou expiré.",
        success: null,
        token: null,
      });
    }

    return res.render("client-reset-password", {
      error: null,
      success: null,
      token,
    });
  } catch (err) {
    console.error("Erreur page reset password client :", err);
    return res.render("client-reset-password", {
      error: "Erreur serveur.",
      success: null,
      token: null,
    });
  }
});

router.post(
  "/reset-password/:token",
  [
    body("mot_de_passe")
      .isLength({ min: 8 })
      .withMessage("Le mot de passe doit contenir au moins 8 caractères."),

    body("mot_de_passe_confirm")
      .custom((value, { req }) => value === req.body.mot_de_passe)
      .withMessage("Les mots de passe ne correspondent pas."),
  ],
  async (req, res) => {
  try {
    res.locals.publicPage = true;
    const token = req.params.token;
    const { mot_de_passe, mot_de_passe_confirm } = req.body;

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.render("client-reset-password", {
        error: errors.array()[0].msg,
        success: null,
        token,
      });
    }

    const [rows] = await pool.query(
      `
      SELECT id
      FROM clients
      WHERE reset_token = ?
        AND reset_token_expire IS NOT NULL
        AND reset_token_expire >= NOW()
      LIMIT 1
      `,
      [token]
    );

    if (rows.length === 0) {
      return res.render("client-reset-password", {
        error: "Lien invalide ou expiré.",
        success: null,
        token: null,
      });
    }

    const clientId = rows[0].id;
    const hash = await bcrypt.hash(mot_de_passe, 10);

    await pool.query(
      `
      UPDATE clients
      SET mot_de_passe = ?,
          reset_token = NULL,
          reset_token_expire = NULL
      WHERE id = ?
      `,
      [hash, clientId]
    );

    return res.render("client-reset-password", {
      error: null,
      success: "Votre mot de passe a bien été réinitialisé. Vous pouvez maintenant vous connecter.",
      token: null,
    });
  } catch (err) {
    console.error("Erreur reset password client :", err);
    return res.render("client-reset-password", {
      error: "Erreur serveur.",
      success: null,
      token: null,
    });
  }
});

router.get("/logout", (req, res) => {
  req.session.client = null;
  return res.redirect("/client/login");
});

router.get("/compte", requireClientLogin, async (req, res) => {
  try {
    res.locals.publicPage = true;

    const clientId = req.session.client.id;
    const tab = ["rdv", "anciens", "fiche"].includes(req.query.tab) ? req.query.tab : "rdv";

    const [clientRows] = await pool.query(
      "SELECT id, nom, email, telephone, created_at, updated_at FROM clients WHERE id = ? LIMIT 1",
      [clientId]
    );

    if (clientRows.length === 0) {
      req.session.client = null;
      return res.redirect("/client/login");
    }

    const clientData = clientRows[0];

    const [upcoming] = await pool.query(
      `
      SELECT
        r.id,
        r.type_seance,
        r.commentaire,
        c.date_heure_debut,
        c.date_heure_fin,
        u.nom AS pro_nom
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      JOIN users u ON u.id = r.user_id
      WHERE r.client_id = ?
        AND c.date_heure_debut >= NOW()
      ORDER BY c.date_heure_debut ASC
      `,
      [clientId]
    );

    const [past] = await pool.query(
      `
      SELECT
        r.id,
        r.type_seance,
        r.commentaire,
        c.date_heure_debut,
        c.date_heure_fin,
        u.nom AS pro_nom
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      JOIN users u ON u.id = r.user_id
      WHERE r.client_id = ?
        AND c.date_heure_debut < NOW()
      ORDER BY c.date_heure_debut DESC
      `,
      [clientId]
    );

    return res.render("client-compte", {
      tab,
      clientData,
      upcoming,
      nextRdv: upcoming.length ? upcoming[0] : null,
      past,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error("Erreur espace client :", err);
    return res.status(500).send("Erreur serveur.");
  }
});

router.post("/fiche", requireClientLogin, async (req, res) => {
  try {
    const clientId = req.session.client.id;
    const {
      nom,
      email,
      telephone,
      mot_de_passe_actuel,
      mot_de_passe,
      mot_de_passe_confirm,
    } = req.body;

    if (!nom || !email || !telephone) {
      return res.redirect("/client/compte?tab=fiche&error=" + encodeURIComponent("Champs requis manquants."));
    }

    const [currentRows] = await pool.query(
      "SELECT * FROM clients WHERE id = ? LIMIT 1",
      [clientId]
    );

    if (currentRows.length === 0) {
      req.session.client = null;
      return res.redirect("/client/login");
    }

    const currentClient = currentRows[0];
    const emailClean = email.trim().toLowerCase();

    const [exists] = await pool.query(
      "SELECT id FROM clients WHERE email = ? AND id <> ? LIMIT 1",
      [emailClean, clientId]
    );

    if (exists.length > 0) {
      return res.redirect("/client/compte?tab=fiche&error=" + encodeURIComponent("Cet email est déjà utilisé."));
    }

    const wantsPasswordChange = !!(mot_de_passe || mot_de_passe_confirm || mot_de_passe_actuel);

    if (wantsPasswordChange) {
      if (!mot_de_passe_actuel || !mot_de_passe || !mot_de_passe_confirm) {
        return res.redirect("/client/compte?tab=fiche&error=" + encodeURIComponent("Pour changer le mot de passe, remplissez les 3 champs."));
      }

      if (mot_de_passe !== mot_de_passe_confirm) {
        return res.redirect("/client/compte?tab=fiche&error=" + encodeURIComponent("Les nouveaux mots de passe ne correspondent pas."));
      }

      const ok = await bcrypt.compare(mot_de_passe_actuel, currentClient.mot_de_passe);
      if (!ok) {
        return res.redirect("/client/compte?tab=fiche&error=" + encodeURIComponent("Mot de passe actuel incorrect."));
      }

      const hash = await bcrypt.hash(mot_de_passe, 10);

      await pool.query(
        "UPDATE clients SET nom = ?, email = ?, telephone = ?, mot_de_passe = ? WHERE id = ?",
        [nom.trim(), emailClean, telephone.trim(), hash, clientId]
      );
    } else {
      await pool.query(
        "UPDATE clients SET nom = ?, email = ?, telephone = ? WHERE id = ?",
        [nom.trim(), emailClean, telephone.trim(), clientId]
      );
    }

    req.session.client = {
      ...req.session.client,
      nom: nom.trim(),
      email: emailClean,
      telephone: telephone.trim(),
    };

    return res.redirect("/client/compte?tab=fiche&success=" + encodeURIComponent("Fiche client mise à jour."));
  } catch (err) {
    console.error("Erreur update fiche client :", err);
    return res.redirect("/client/compte?tab=fiche&error=" + encodeURIComponent("Erreur serveur."));
  }
});

router.post("/rdv/:id/annuler", requireClientLogin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const clientId = req.session.client.id;
    const rdvId = req.params.id;

    const [rows] = await conn.query(
      `
      SELECT 
        r.id, r.creneau_id, r.type_seance_id, r.type_seance,
        c.user_id,
        c.date_heure_debut AS c_start,
        c.date_heure_fin AS c_end,
        u.email AS pro_email,
        u.nom AS pro_nom,
        ts.duree_minutes
      FROM rdv r
      JOIN creneaux c ON c.id = r.creneau_id
      JOIN users u ON u.id = c.user_id
      LEFT JOIN types_seance ts ON ts.id = r.type_seance_id
      WHERE r.id = ? AND r.client_id = ?
      LIMIT 1
      `,
      [rdvId, clientId]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.redirect("/client/compte?error=" + encodeURIComponent("RDV introuvable."));
    }

    const rdv = rows[0];
    const startDate = parseMysqlDateTimeToDate(rdv.c_start);

    if (startDate <= new Date()) {
      await conn.rollback();
      return res.redirect("/client/compte?error=" + encodeURIComponent("Impossible d'annuler un rendez-vous passé."));
    }

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

    await conn.query(
      "UPDATE creneaux SET statut = 'libre', date_heure_fin = ? WHERE id = ? AND user_id = ?",
      [restoredEndSql, rdv.creneau_id, rdv.user_id]
    );

    await conn.query(
      "DELETE FROM rdv WHERE id = ? AND client_id = ?",
      [rdvId, clientId]
    );

    await conn.commit();

    if (rdv.pro_email) {
      await sendMailSafe({
        to: rdv.pro_email,
        subject: "Annulation d'un rendez-vous client",
        text:
          `Un rendez-vous a été annulé par le client.\n\n` +
          `Client : ${req.session.client.nom}\n` +
          `Email : ${req.session.client.email}\n` +
          `Téléphone : ${req.session.client.telephone || "-"}\n` +
          `Type : ${rdv.type_seance || "-"}\n` +
          `Début : ${startDate.toLocaleString("fr-FR")}\n` +
          `Praticienne : ${rdv.pro_nom}\n`,
      });
    }

    return res.redirect("/client/compte?success=" + encodeURIComponent("Votre rendez-vous a bien été annulé."));
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {}
    }
    console.error("Erreur annulation client :", err);
    return res.redirect("/client/compte?error=" + encodeURIComponent("Erreur serveur."));
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;