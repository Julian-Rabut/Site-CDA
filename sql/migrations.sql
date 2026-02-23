-- À exécuter si ta base existe déjà (ajouts sans casser)

ALTER TABLE rdv ADD COLUMN IF NOT EXISTS commentaire TEXT NULL;
ALTER TABLE rdv ADD COLUMN IF NOT EXISTS reminder_sent TINYINT(1) NOT NULL DEFAULT 0;

-- Si ta table types_seance ne contient pas la durée:
ALTER TABLE types_seance ADD COLUMN IF NOT EXISTS duree_minutes INT NOT NULL DEFAULT 60;

-- Ajout colonne commentaire sur creneaux (sert au blocage journée avec commentaire)
ALTER TABLE creneaux ADD COLUMN IF NOT EXISTS commentaire VARCHAR(255) NULL;

-- Table fiche pro
CREATE TABLE IF NOT EXISTS pro_profile (
  user_id INT PRIMARY KEY,
  titre VARCHAR(120) NULL,
  description TEXT NULL,
  adresse VARCHAR(255) NULL,
  ville VARCHAR(120) NULL,
  telephone VARCHAR(50) NULL,
  email_public VARCHAR(150) NULL,
  paiement VARCHAR(255) NULL,
  regles TEXT NULL,
  itineraire_url VARCHAR(500) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pro_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;