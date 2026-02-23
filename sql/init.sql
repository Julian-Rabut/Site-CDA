-- Base de données: agenda

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  telephone VARCHAR(40) NULL,
  mot_de_passe VARCHAR(255) NOT NULL,
  role ENUM('praticien','admin') NOT NULL DEFAULT 'praticien',
  couleur_agenda VARCHAR(20) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TYPES DE SEANCE
CREATE TABLE IF NOT EXISTS types_seance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  nom VARCHAR(120) NOT NULL,
  duree_minutes INT NOT NULL DEFAULT 60,
  couleur VARCHAR(20) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description VARCHAR(200) NULL,
  CONSTRAINT fk_types_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- CRENEAUX
CREATE TABLE IF NOT EXISTS creneaux (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date_heure_debut DATETIME NOT NULL,
  date_heure_fin DATETIME NOT NULL,
  commentaire VARCHAR(255) NULL,
  statut ENUM('libre','reserve','bloque') NOT NULL DEFAULT 'libre',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_creneaux_user_date (user_id, date_heure_debut),
  CONSTRAINT fk_creneaux_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- RDV
CREATE TABLE IF NOT EXISTS rdv (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  creneau_id INT NOT NULL,
  nom_client VARCHAR(120) NOT NULL,
  email_client VARCHAR(190) NULL,
  tel_client VARCHAR(40) NULL,
  type_seance VARCHAR(120) NULL,
  type_seance_id INT NULL,
  commentaire TEXT NULL,
  statut ENUM('confirme','annule') NOT NULL DEFAULT 'confirme',
  reminder_sent TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rdv_user (user_id),
  CONSTRAINT fk_rdv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rdv_creneau FOREIGN KEY (creneau_id) REFERENCES creneaux(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS journees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date_jour DATE NOT NULL,
  praticien_id INT NOT NULL,
  est_generee TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_jour_praticien (date_jour, praticien_id),
  CONSTRAINT fk_journees_user FOREIGN KEY (praticien_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table fiche pro (si elle n'existe pas)
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

  -- AJOUTS PRIORITÉ 1
  photo_url VARCHAR(500) NULL,
  tarifs TEXT NULL,
  horaires TEXT NULL,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pro_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Si la table existe déjà mais pas les colonnes :
ALTER TABLE pro_profile ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500) NULL;
ALTER TABLE pro_profile ADD COLUMN IF NOT EXISTS tarifs TEXT NULL;
ALTER TABLE pro_profile ADD COLUMN IF NOT EXISTS horaires TEXT NULL;
