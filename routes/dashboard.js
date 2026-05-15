"use strict";

const express = require("express");

const pool = require("../config/db");
const { requireLogin } = require("../middlewares/auth");
const { toMysqlDateTime, parseMysqlDateTimeToDate } = require("../utils/dates");
const { hasOverlap, consumeFreeSlots } = require("../utils/slots");

const router = express.Router();

router.get("/dashboard", requireLogin, async (req, res) => {
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
      `
      SELECT id, date_heure_debut, date_heure_fin, statut
      FROM creneaux
      WHERE user_id = ? AND statut = 'libre'
      ORDER BY date_heure_debut ASC
      `,
      [userId]
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
      clientsAll: [],
      creneauxLibres: [],
    });
  }
});

router.get("/clients", requireLogin, async (req, res) => {
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

router.get("/rdvs", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const q = (req.query.q || "").trim();
    const statut = (req.query.statut || "").trim();

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
      ...rdvs.map((r) => ({
        date_heure_debut: r.date_heure_debut,
        date_heure_fin: r.date_heure_fin,
        nom_client: r.nom_client,
        email_client: r.email_client,
        tel_client: r.tel_client,
        type_seance: r.type_seance,
        commentaire: r.commentaire,
        statut: r.statut,
      })),
      ...libres.map((c) => ({
        date_heure_debut: c.date_heure_debut,
        date_heure_fin: c.date_heure_fin,
        nom_client: null,
        email_client: null,
        tel_client: null,
        type_seance: null,
        commentaire: null,
        statut: "libre",
      })),
    ].sort((a, b) => new Date(b.date_heure_debut) - new Date(a.date_heure_debut));

    res.render("rdvs", { q, statut, items });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

router.post("/creneaux", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const { date_heure_debut, date_heure_fin } = req.body;
    const { date_debut, heure_debut, duree_minutes } = req.body;

    let start;
    let end;

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

router.post("/types-seance", requireLogin, async (req, res) => {
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

router.post("/types-seance/:id/delete", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const typeId = Number(req.params.id);

    if (!typeId) {
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Type invalide."));
    }

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

router.post("/rdv-manuel", requireLogin, async (req, res) => {
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

router.post("/creneaux/:id/bloquer", requireLogin, async (req, res) => {
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
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Seuls les créneaux libres peuvent être bloqués."));
    }

    await pool.query(
      "UPDATE creneaux SET statut = 'bloque' WHERE id = ? AND user_id = ?",
      [creneauId, userId]
    );

    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Créneau bloqué "));
  } catch (err) {
    console.error("Erreur bloquer créneau :", err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});

router.post("/creneaux/:id/liberer", requireLogin, async (req, res) => {
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
      return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Seuls les créneaux bloqués peuvent être libérés."));
    }

    await pool.query(
      "UPDATE creneaux SET statut = 'libre' WHERE id = ? AND user_id = ?",
      [creneauId, userId]
    );

    return res.redirect("/auth/dashboard?success=" + encodeURIComponent("Créneau libéré "));
  } catch (err) {
    console.error("Erreur liberer créneau :", err);
    return res.redirect("/auth/dashboard?error=" + encodeURIComponent("Erreur serveur."));
  }
});

router.get("/journee/generer", requireLogin, (req, res) => {
  res.render("generer-journee", { user: req.session.user });
});

router.post("/journee/generer", requireLogin, async (req, res) => {
  try {
    const { date, startTime, endTime, slotMinutes, breakMinutes } = req.body;

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

router.get("/journee/bloquer", requireLogin, (req, res) => {
  res.render("bloquer-journee", { user: req.session.user });
});

router.post("/journee/bloquer", requireLogin, async (req, res) => {
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
      [userId, startSql, endSql, commentaire ? String(commentaire).slice(0, 255) : null]
    );

    return res.redirect("/auth/calendar");
  } catch (err) {
    console.error("Erreur page bloquer:", err);
    return res.redirect("/auth/journee/bloquer?error=" + encodeURIComponent("Erreur serveur."));
  }
});

router.get("/dupliquer-journee", requireLogin, (req, res) => {
  res.render("dupliquer-journee", { user: req.session.user });
});

router.post("/dupliquer-journee", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date_source, date_cible, overwrite } = req.body;

    if (!date_source || !date_cible) return res.redirect("/auth/dupliquer-journee");
    if (date_source === date_cible) return res.redirect("/auth/dupliquer-journee");

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

module.exports = router;