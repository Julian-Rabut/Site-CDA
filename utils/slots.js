"use strict";

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

async function consumeFreeSlots(connOrPool, userId, startSql, endSql, excludeCreneauId = null) {
  const params = [userId, endSql, startSql];
  let exclude = "";

  if (excludeCreneauId) {
    exclude = "AND id <> ? ";
    params.splice(1, 0, excludeCreneauId);
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

    if (cStart >= startSql && cEnd <= endSql) {
      await connOrPool.query(
        "DELETE FROM creneaux WHERE id = ? AND user_id = ?",
        [c.id, userId]
      );
      continue;
    }

    if (cStart < startSql && cEnd > startSql && cEnd <= endSql) {
      await connOrPool.query(
        "UPDATE creneaux SET date_heure_fin = ? WHERE id = ? AND user_id = ?",
        [startSql, c.id, userId]
      );
      continue;
    }

    if (cStart >= startSql && cStart < endSql && cEnd > endSql) {
      await connOrPool.query(
        "UPDATE creneaux SET date_heure_debut = ? WHERE id = ? AND user_id = ?",
        [endSql, c.id, userId]
      );
      continue;
    }

    if (cStart < startSql && cEnd > endSql) {
      await connOrPool.query(
        "UPDATE creneaux SET date_heure_fin = ? WHERE id = ? AND user_id = ?",
        [startSql, c.id, userId]
      );

      await connOrPool.query(
        "INSERT INTO creneaux (user_id, date_heure_debut, date_heure_fin, statut) VALUES (?, ?, ?, 'libre')",
        [userId, endSql, cEnd]
      );
    }
  }
}

module.exports = {
  hasOverlap,
  consumeFreeSlots,
};