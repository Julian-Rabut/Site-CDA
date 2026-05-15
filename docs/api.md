# Documentation API

## Routes publiques

### GET /
Redirige selon le sous-domaine utilisé.

### GET /rdv
Affiche la page de rendez-vous ou redirige vers la connexion client.

### GET /rdv/:userId
Affiche le profil public de la praticienne, les types de séance et les créneaux disponibles.

### GET /rdv/reserver/:id
Affiche le formulaire de confirmation pour un créneau.

### POST /rdv/reserver
Réserve un rendez-vous pour un client connecté.

Contrôles :
- client connecté obligatoire ;
- créneau libre ;
- type de séance valide ;
- vérification des chevauchements ;
- transaction SQL ;
- envoi d’e-mails.

---

## Routes client

### GET /client/login
Affiche le formulaire de connexion client.

### POST /client/login
Connecte un client.

Contrôles :
- email valide ;
- mot de passe requis ;
- comparaison bcrypt.

### GET /client/register
Affiche le formulaire de création de compte client.

### POST /client/register
Crée un compte client.

Contrôles :
- nom obligatoire ;
- email valide ;
- téléphone obligatoire ;
- mot de passe minimum 8 caractères ;
- confirmation identique ;
- hash bcrypt.

### GET /client/compte
Affiche l’espace personnel du client.

### POST /client/rdv/:id/annuler
Permet au client d’annuler un rendez-vous futur.

---

## Routes praticienne

### GET /auth/login
Affiche la page de connexion praticienne.

### POST /auth/login
Connecte la praticienne.

### GET /auth/dashboard
Affiche le tableau de bord praticienne.

### GET /auth/calendar
Affiche le calendrier FullCalendar.

### POST /auth/api/creneaux-from-calendar
Crée un créneau depuis le calendrier.

### POST /auth/api/rdv-from-calendar
Crée un rendez-vous depuis le calendrier.

### POST /auth/api/rdv/:id/move
Déplace un rendez-vous.

### POST /auth/api/block-day
Bloque une journée.