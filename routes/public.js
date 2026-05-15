"use strict";

const express = require("express");

const pool = require("../config/db");
const { toMysqlDateTime, parseMysqlDateTimeToDate } = require("../utils/dates");
const { sendMailSafe } = require("../services/mailService");

const router = express.Router();

router.get("/", (req, res) => {
  const host = (req.hostname || "").toLowerCase();

  if (host.startsWith("pro.")) {
    return res.redirect("/auth/login");
  }

  if (host.startsWith("rdv.")) {
    res.locals.publicPage = true;
    return res.render("rdv-home");
  }

  return res.redirect("https://rdv.dansmabulle-reflexologue.fr/");
});

router.get("/rdv", async (req, res) => {
  try {
    res.locals.publicPage = true;

    if (!req.session.client) {
      return res.redirect("/client/login?next=%2Frdv");
    }

    const [praticiens] = await pool.query(
      "SELECT id, nom, email, couleur_agenda FROM users WHERE role = 'praticien' ORDER BY nom ASC"
    );

    return res.render("liste-praticiens", { praticiens });
  } catch (err) {
    console.error("Erreur chargement praticiens :", err);
    return res.status(500).send("Erreur serveur");
  }
});

router.get("/rdv/:userId", async (req, res) => {
  try {
    res.locals.publicPage = true;

    if (!req.session.client) {
      return res.redirect(`/client/login?next=${encodeURIComponent(req.originalUrl)}`);
    }

    const userId = Number(req.params.userId);

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

    const selectedType = typesSeance.find((t) => String(t.id) === String(selectedTypeId));
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
      .map((c) => ({
        id: c.id,
        start: parseMysqlDateTimeToDate(c.date_heure_debut).getTime(),
        end: parseMysqlDateTimeToDate(c.date_heure_fin).getTime(),
        raw: c,
      }))
      .sort((a, b) => a.start - b.start);

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

      const freeSlots = allSlots.filter(
        (s) => s.start >= oldEnd.getTime() && (!barrierStart || s.start < barrierStart.getTime())
      );

      const ok = canAutoShiftFreeSlots({
        chosenOldEnd: oldEnd,
        desiredEnd,
        freeSlots,
        barrierStart,
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

router.get("/rdv/reserver/:id", async (req, res) => {
  try {
    res.locals.publicPage = true;

    if (!req.session.client) {
      return res.redirect(`/client/login?next=${encodeURIComponent(req.originalUrl)}`);
    }

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

    let displayFin = creneau.date_heure_fin;
    if (selectedTypeId) {
      const t = typesSeance.find((x) => String(x.id) === String(selectedTypeId));
      if (t && t.duree_minutes) {
        displayFin = new Date(
          creneau.date_heure_debut.getTime() + parseInt(t.duree_minutes, 10) * 60000
        );
      }
    }

    return res.render("formulaire-rdv", {
      creneau,
      typesSeance,
      selectedTypeId,
      displayFin,
      error: null,
    });
  } catch (err) {
    console.error("Erreur formulaire rdv:", err);
    return res.status(500).send("Erreur serveur.");
  }
});

router.post("/rdv/reserver", async (req, res) => {
  let conn;
  try {
    res.locals.publicPage = true;

    const { creneau_id, type_seance_id, commentaire } = req.body;

    if (!req.session.client) {
      return res.redirect("/client/login?next=%2Frdv");
    }

    if (!creneau_id || !type_seance_id) {
      return res.status(400).send("Champs requis manquants.");
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

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

    const [clientRows] = await conn.query(
      "SELECT id, nom, email, telephone FROM clients WHERE id = ? LIMIT 1",
      [req.session.client.id]
    );

    if (clientRows.length === 0) {
      await conn.rollback();
      req.session.client = null;
      return res.redirect("/client/login");
    }

    const clientData = clientRows[0];

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

    if (desiredEnd.getTime() < oldEnd.getTime()) {
      await conn.query(
        "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES (?, ?, ?, 'libre')",
        [userId, endSql, toMysqlDateTime(oldEnd.toISOString())]
      );
    }

    if (desiredEnd.getTime() > oldEnd.getTime()) {
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

    await conn.query(
      "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ?, statut = 'reserve' WHERE id = ? AND user_id = ?",
      [startSql, endSql, creneau.id, userId]
    );

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

    await conn.query(
      `
      INSERT INTO rdv (
        user_id,
        client_id,
        creneau_id,
        nom_client,
        email_client,
        tel_client,
        type_seance,
        type_seance_id,
        commentaire,
        statut,
        reminder_sent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirme', 0)
      `,
      [
        userId,
        clientData.id,
        creneau.id,
        clientData.nom,
        clientData.email || null,
        clientData.telephone || null,
        type.nom,
        type.id,
        commentaire || null,
      ]
    );

    await conn.commit();

    const [pr] = await pool.query("SELECT email, nom FROM users WHERE id = ?", [userId]);

    if (pr.length && pr[0].email) {
      await sendMailSafe({
        to: pr[0].email,
        subject: "Nouveau rendez-vous réservé",
        text:
          `Un nouveau RDV a été réservé.\n\n` +
          `Client: ${clientData.nom}\n` +
          `Email: ${clientData.email || "-"}\n` +
          `Téléphone: ${clientData.telephone || "-"}\n` +
          `Type: ${type.nom}\n` +
          `Début: ${start.toLocaleString("fr-FR")}\n` +
          `Fin: ${desiredEnd.toLocaleString("fr-FR")}\n` +
          (commentaire ? `\nCommentaire: ${commentaire}\n` : ""),
      });
    }

    if (clientData.email) {
      await sendMailSafe({
        to: clientData.email,
        subject: "Confirmation de votre rendez-vous",
        text:
          `Bonjour ${clientData.nom},\n\n` +
          `Votre rendez-vous est confirmé.\n\n` +
          `Type: ${type.nom}\n` +
          `Début: ${start.toLocaleString("fr-FR")}\n` +
          `Fin: ${desiredEnd.toLocaleString("fr-FR")}\n` +
          `Praticienne: ${pr.length ? pr[0].nom : ""}\n` +
          (commentaire ? `\nCommentaire transmis: ${commentaire}\n` : ""),
      });
    }

    return res.redirect("/client/compte?success=" + encodeURIComponent("Votre rendez-vous est bien réservé."));
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

module.exports = router;