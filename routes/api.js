"use strict";

const express = require("express");

const pool = require("../config/db");
const { requireLogin } = require("../middlewares/auth");
const { toMysqlDateTime, parseMysqlDateTimeToDate } = require("../utils/dates");
const { hasOverlap, consumeFreeSlots } = require("../utils/slots");

const router = express.Router();

router.post("/api/creneaux/:id/liberer", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { id } = req.params;

    const [rows] = await pool.query(
      "SELECT * FROM creneaux WHERE id = ? AND user_id = ?",
      [id, userId]
    );

    if (rows.length === 0) {
      return res.json({ success: false, error: "Créneau introuvable." });
    }

    await pool.query(
      "DELETE FROM creneaux WHERE id = ? AND user_id = ? AND statut = 'bloque'",
      [id, userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

router.get("/api/clients", requireLogin, async (req, res) => {
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

router.get("/api/stats/clients-par-mois", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;

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

    const map = new Map(rows.map((r) => [r.mois, Number(r.nb || 0)]));
    const now = new Date();
    const labels = [];
    const values = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      labels.push(key);
      values.push(map.get(key) ?? 0);
    }

    res.json({ success: true, labels, values });
  } catch (e) {
    console.error("Erreur stats clients/mois:", e);
    res.json({ success: false, error: "Erreur serveur." });
  }
});

router.get("/api/events", requireLogin, async (req, res) => {
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

    for (const c of creneaux) {
      let color = "#16a34a";
      let title = "Créneau libre";

      if (c.statut === "bloque") {
        color = "#dc2626";
        title = c.commentaire ? `Bloqué: ${c.commentaire}` : "Créneau bloqué";
      } else if (c.statut === "reserve") {
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

    for (const r of rdvs) {
      if (r.statut === "annule") continue;

      const c = creneaux.find((x) => String(x.id) === String(r.creneau_id));
      if (!c) continue;

      const color = r.type_couleur || "#2563eb";
      const title = r.nom_client || "RDV";

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

router.get("/api/types-seance", requireLogin, async (req, res) => {
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

router.post("/api/creneaux-from-calendar", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { start, end } = req.body;

    if (!start || !end) {
      return res.json({ success: false, error: "Dates manquantes." });
    }

    const startSql = toMysqlDateTime(start);
    const endSql = toMysqlDateTime(end);

    const overlap = await hasOverlap(pool, userId, startSql, endSql);
    if (overlap) {
      return res.json({
        success: false,
        error: "Superposition détectée : impossible de créer ce créneau.",
      });
    }

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

router.post("/api/creneaux/:id/move", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const creneauId = req.params.id;
    const { start, end } = req.body;

    if (!start || !end) {
      return res.json({ success: false, error: "Dates manquantes." });
    }

    const [rows] = await pool.query(
      "SELECT * FROM creneaux WHERE id = ? AND user_id = ?",
      [creneauId, userId]
    );

    if (rows.length === 0) {
      return res.json({ success: false, error: "Créneau introuvable." });
    }

    const c = rows[0];
    if (c.statut !== "libre") {
      return res.json({ success: false, error: "Seuls les créneaux libres sont modifiables." });
    }

    const startSql = toMysqlDateTime(start);
    const endSql = toMysqlDateTime(end);

    const overlap = await hasOverlap(pool, userId, startSql, endSql, creneauId);
    if (overlap) {
      return res.json({
        success: false,
        error: "Superposition détectée : déplacement impossible.",
      });
    }

    await pool.query(
      "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ?",
      [toMysqlDateTime(start), toMysqlDateTime(end), creneauId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur move creneau:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

router.post("/api/creneaux/:id/supprimer", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const creneauId = req.params.id;

    const [rows] = await pool.query(
      "SELECT * FROM creneaux WHERE id = ? AND user_id = ?",
      [creneauId, userId]
    );

    if (rows.length === 0) {
      return res.json({ success: false, error: "Créneau introuvable." });
    }

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

router.post("/api/rdv-direct-from-calendar", requireLogin, async (req, res) => {
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

    if (types.length === 0) {
      return res.json({ success: false, error: "Type de séance invalide." });
    }

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

router.post("/api/rdv-from-calendar", requireLogin, async (req, res) => {
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

    const dayStr = oldStart.toISOString().slice(0, 10);
    const [jrows] = await conn.query(
      "SELECT end_time FROM journees WHERE user_id = ? AND date_jour = ? LIMIT 1",
      [userId, dayStr]
    );

    let dayEnd = null;
    if (jrows.length > 0) {
      const endTime = jrows[0].end_time;
      dayEnd = new Date(`${dayStr}T${String(endTime).slice(0, 5)}:00`);
    }

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

    const barrierStart = nextHard.length
      ? parseMysqlDateTimeToDate(nextHard[0].date_heure_debut)
      : null;

    let hardLimit = null;
    if (barrierStart && dayEnd) hardLimit = barrierStart < dayEnd ? barrierStart : dayEnd;
    else hardLimit = barrierStart || dayEnd;

    if (hardLimit && desiredEnd > hardLimit) {
      await conn.rollback();
      return res.json({
        success: false,
        error: "Ce créneau ne permet pas la durée de cette séance avant la fin de journée / prochain RDV.",
      });
    }

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
        error: "Impossible : la durée de la séance chevauche un RDV ou une période bloquée. Choisis un autre créneau.",
      });
    }

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

    await conn.query(
      "UPDATE creneaux SET date_heure_fin = ?, statut = 'reserve' WHERE id = ?",
      [endSql, creneau.id]
    );

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
        const idsToDelete = [
          slot.id,
          ...freeSlots.slice(freeSlots.indexOf(slot) + 1).map((s) => s.id),
        ];

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

      if (
        slotOldStart.getTime() >= newStart.getTime() &&
        slotOldEnd.getTime() >= newEnd.getTime()
      ) {
        cursor = slotOldEnd;
        prevOldEnd = slotOldEnd;
        continue;
      }

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
          error: "Impossible de décaler automatiquement les créneaux libres car un RDV (ou une période bloquée) empêche le décalage. Choisis un autre créneau ou décale manuellement.",
        });
      }

      await conn.query(
        "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ?",
        [newStartSql, newEndSql, slot.id]
      );

      cursor = newEnd;
      prevOldEnd = slotOldEnd;
    }

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
    return res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la création du RDV.",
    });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/api/rdv/:id/annuler", requireLogin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const userId = req.session.user.id;
    const rdvId = req.params.id;

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

    await conn.query(
      "UPDATE creneaux SET statut = 'libre', date_heure_fin = ? WHERE id = ? AND user_id = ?",
      [restoredEndSql, rdv.creneau_id, userId]
    );

    await conn.query("DELETE FROM rdv WHERE id = ? AND user_id = ?", [rdvId, userId]);

    await conn.commit();
    return res.json({ success: true });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {}
    }
    console.error("Erreur annuler RDV:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/api/rdv/:id/move", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;
    const { start } = req.body;

    if (!start) {
      return res.json({ success: false, error: "Date de début manquante." });
    }

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

    if (rows.length === 0) {
      return res.json({ success: false, error: "RDV introuvable." });
    }

    const rdv = rows[0];

    const oldStart =
      rdv.date_heure_debut instanceof Date ? rdv.date_heure_debut : new Date(rdv.date_heure_debut);
    const oldEnd =
      rdv.date_heure_fin instanceof Date ? rdv.date_heure_fin : new Date(rdv.date_heure_fin);

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

router.post("/api/generate-day-slots", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date, startTime, endTime, slotMinutes, breakMinutes } = req.body;

    if (!date || !startTime || !endTime || !slotMinutes) {
      return res.json({ success: false, error: "Paramètres manquants." });
    }

    const slotM = parseInt(slotMinutes, 10);
    const breakM = parseInt(breakMinutes || 0, 10);

    if (isNaN(slotM) || slotM <= 0) {
      return res.json({ success: false, error: "Durée créneau invalide." });
    }

    if (isNaN(breakM) || breakM < 0) {
      return res.json({ success: false, error: "Pause invalide." });
    }

    let cursor = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);

    if (cursor >= end) {
      return res.json({ success: false, error: "Heures invalides." });
    }

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

    if (inserts.length === 0) {
      return res.json({ success: false, error: "Aucun créneau généré." });
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

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur generate-day-slots:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

router.post("/api/block-day", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date, commentaire } = req.body;

    if (!date) {
      return res.json({ success: false, error: "Date manquante." });
    }

    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59`);

    const startSql = toMysqlDateTime(start.toISOString());
    const endSql = toMysqlDateTime(end.toISOString());

    const overlap = await hasOverlap(pool, userId, startSql, endSql);
    if (overlap) {
      return res.json({
        success: false,
        error: "Superposition : impossible de bloquer la journée (il existe déjà des créneaux/RDV).",
      });
    }

    await pool.query(
      "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut, commentaire) VALUES (?, ?, ?, 'bloque', ?)",
      [userId, startSql, endSql, commentaire ? String(commentaire).slice(0, 255) : null]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur block-day:", err);
    return res.json({ success: false, error: "Erreur serveur." });
  }
});

module.exports = router;