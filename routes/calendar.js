"use strict";

const express = require("express");

const pool = require("../config/db");
const { requireLogin } = require("../middlewares/auth");
const { toMysqlDateTime, parseMysqlDateTimeToDate } = require("../utils/dates");
const { hasOverlap } = require("../utils/slots");

const router = express.Router();

// ================= CALENDAR PAGE =================
router.get("/calendar", requireLogin, (req, res) => {
  res.render("calendar", { user: req.session.user });
});

// ================= MODIFIER DATETIME =================
router.get("/rdv/:id/modifier-datetime", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;

    const [rows] = await pool.query(
      `SELECT r.id, r.nom_client, r.type_seance,
              c.date_heure_debut, c.date_heure_fin
       FROM rdv r
       JOIN creneaux c ON c.id = r.creneau_id
       WHERE r.id = ? AND r.user_id = ?`,
      [rdvId, userId]
    );

    if (!rows.length) return res.redirect("/auth/calendar");

    const rdv = rows[0];
    const d = parseMysqlDateTimeToDate(rdv.date_heure_debut);

    res.render("modifier-rdv-datetime", {
      rdv,
      user: req.session.user,
      defaultDate: d.toISOString().slice(0, 10),
      defaultTime: d.toTimeString().slice(0, 5),
      error: req.query.error || null,
    });
  } catch (err) {
    console.error(err);
    res.redirect("/auth/calendar");
  }
});

// ================= POST DATETIME =================
router.post("/rdv/:id/modifier-datetime", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;
    const { date, time } = req.body;

    if (!date || !time) {
      return res.redirect(`/auth/rdv/${rdvId}/modifier-datetime?error=Date manquante`);
    }

    const [rows] = await pool.query(
      `SELECT r.creneau_id, c.date_heure_debut, c.date_heure_fin
       FROM rdv r
       JOIN creneaux c ON c.id = r.creneau_id
       WHERE r.id = ? AND r.user_id = ?`,
      [rdvId, userId]
    );

    if (!rows.length) return res.redirect("/auth/calendar");

    const c = rows[0];
    const oldStart = parseMysqlDateTimeToDate(c.date_heure_debut);
    const oldEnd = parseMysqlDateTimeToDate(c.date_heure_fin);

    const duration = oldEnd - oldStart;

    const newStart = new Date(`${date}T${time}:00`);
    if (isNaN(newStart.getTime())) {
      return res.redirect(`/auth/rdv/${rdvId}/modifier-datetime?error=Date invalide`);
    }

    const newEnd = new Date(newStart.getTime() + duration);

    const overlap = await hasOverlap(
      pool,
      userId,
      toMysqlDateTime(newStart.toISOString()),
      toMysqlDateTime(newEnd.toISOString()),
      c.creneau_id
    );

    if (overlap) {
      return res.redirect(`/auth/rdv/${rdvId}/modifier-datetime?error=Chevauchement`);
    }

    await pool.query(
      "UPDATE creneaux SET date_heure_debut = ?, date_heure_fin = ? WHERE id = ?",
      [
        toMysqlDateTime(newStart.toISOString()),
        toMysqlDateTime(newEnd.toISOString()),
        c.creneau_id,
      ]
    );

    res.redirect("/auth/calendar");
  } catch (err) {
    console.error(err);
    res.redirect("/auth/calendar");
  }
});

// ================= MODIFIER RDV DEPUIS /auth/rdvs =================
router.get("/rdvs/:id/modifier", requireLogin, async (req, res) => {
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

router.post("/rdvs/:id/modifier", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const rdvId = req.params.id;
    const { date, time } = req.body;

    if (!date || !time) return res.redirect(`/auth/rdvs/${rdvId}/modifier`);

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
      return res.redirect(
        `/auth/rdvs/${rdvId}/modifier?error=` + encodeURIComponent("Chevauchement détecté.")
      );
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

// ================= MODIFIER RDV COMPLET =================
router.get("/rdv/:id/modifier", requireLogin, async (req, res) => {
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

router.post("/rdv/:id/modifier", requireLogin, async (req, res) => {
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

    const updates = {};
    if (req.body.edit_nom === "1") updates.nom_client = req.body.nom_client || "";
    if (req.body.edit_email === "1") updates.email_client = req.body.email_client || "";
    if (req.body.edit_tel === "1") updates.tel_client = req.body.tel_client || "";
    if (req.body.edit_commentaire === "1") updates.commentaire = req.body.commentaire || null;

    if (req.body.edit_type === "1") {
      const tid = req.body.type_seance_id ? Number(req.body.type_seance_id) : null;
      updates.type_seance_id = tid;

      if (tid) {
        const [trows] = await pool.query(
          "SELECT nom, duree_minutes FROM types_seance WHERE id = ? AND user_id = ? LIMIT 1",
          [tid, userId]
        );

        if (trows.length) {
          updates.type_seance = trows[0].nom;

          const dm = parseInt(trows[0].duree_minutes, 10);
          if (!isNaN(dm) && dm > 0) {
            const [crows] = await pool.query(
              "SELECT date_heure_debut FROM creneaux WHERE id = ? AND user_id = ? LIMIT 1",
              [rdv.creneau_id, userId]
            );

            if (crows.length) {
              const startDate = parseMysqlDateTimeToDate(crows[0].date_heure_debut);
              const newEnd = new Date(startDate.getTime() + dm * 60 * 1000);

              const startSql = toMysqlDateTime(startDate.toISOString());
              const endSql = toMysqlDateTime(newEnd.toISOString());

              const overlap = await hasOverlap(pool, userId, startSql, endSql, rdv.creneau_id);
              if (overlap) {
                return res.redirect(
                  `/auth/rdv/${rdvId}/modifier?error=` +
                    encodeURIComponent("Chevauchement : impossible avec la nouvelle durée.")
                );
              }

              await pool.query(
                "UPDATE creneaux SET date_heure_fin = ? WHERE id = ? AND user_id = ?",
                [endSql, rdv.creneau_id, userId]
              );
            }
          }
        } else {
          updates.type_seance = null;
        }
      } else {
        updates.type_seance = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.keys(updates).map((k) => updates[k]);

      await pool.query(`UPDATE rdv SET ${fields} WHERE id = ? AND user_id = ?`, [
        ...values,
        rdvId,
        userId,
      ]);
    }

    if (req.body.edit_datetime === "1") {
      const { date, time } = req.body;

      if (!date || !time) {
        return res.redirect(
          `/auth/rdv/${rdvId}/modifier?error=` + encodeURIComponent("Date/heure manquante.")
        );
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
        durMs = !isNaN(dm) && dm > 0 ? dm * 60 * 1000 : 60 * 60 * 1000;
      }

      const newStart = new Date(`${date}T${time}:00`);
      if (isNaN(newStart.getTime())) {
        return res.redirect(
          `/auth/rdv/${rdvId}/modifier?error=` + encodeURIComponent("Date/heure invalide.")
        );
      }

      const newEnd = new Date(newStart.getTime() + durMs);
      const startSql = toMysqlDateTime(newStart.toISOString());
      const endSql = toMysqlDateTime(newEnd.toISOString());

      const overlap = await hasOverlap(pool, userId, startSql, endSql, rdv.creneau_id);
      if (overlap) {
        return res.redirect(
          `/auth/rdv/${rdvId}/modifier?error=` + encodeURIComponent("Chevauchement détecté.")
        );
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

module.exports = router;