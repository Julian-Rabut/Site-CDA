"use strict";

const cron = require("node-cron");
const pool = require("../config/db");
const { sendMailSafe } = require("../services/mailService");

function startReminderJob() {
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
            `À bientôt,\n${r.pro_nom}`,
        });

        await pool.query("UPDATE rdv SET reminder_sent=1 WHERE id=?", [r.id]);
      }
    } catch (e) {
      console.error("Cron rappel 24h error:", e);
    }
  });
}

module.exports = {
  startReminderJob,
};