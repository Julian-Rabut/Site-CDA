"use strict";

const express = require("express");

const pool = require("../config/db");
const { requireLogin } = require("../middlewares/auth");

const router = express.Router();

router.get("/profil", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [rows] = await pool.query(
      "SELECT * FROM pro_profile WHERE user_id = ? LIMIT 1",
      [userId]
    );

    const profile = rows.length ? rows[0] : { user_id: userId };

    const [types] = await pool.query(
      "SELECT id, nom, duree_minutes, description FROM types_seance WHERE user_id = ? ORDER BY id DESC",
      [userId]
    );

    res.render("profil-pro", {
      user: req.session.user,
      profile,
      types,
    });
  } catch (err) {
    console.error("Erreur GET /auth/profil:", err);
    res.redirect("/auth/calendar");
  }
});

router.post("/profil", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const {
      titre,
      description,
      adresse,
      ville,
      telephone,
      email_public,
      paiement,
      regles,
      itineraire_url,
      photo_url,
      tarifs,
      horaires,
      description_seances,
    } = req.body;

    let itineraire = (itineraire_url || "").trim();
    if (itineraire && !/^https?:\/\//i.test(itineraire)) {
      itineraire = "https://" + itineraire;
    }

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
        description_seances || null,
      ]
    );

    res.redirect("/auth/profil");
  } catch (err) {
    console.error("Erreur POST /auth/profil:", err);
    res.redirect("/auth/profil");
  }
});

module.exports = router;