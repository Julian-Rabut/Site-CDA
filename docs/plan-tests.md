# Plan de tests

## Outils

Les tests automatisés sont réalisés avec :
- Jest ;
- Supertest.

Commandes :

```bash
npm test
npm run test:coverage
Tests automatisés
ID	Cas testé	Résultat attendu
T01	Accueil	Affichage ou redirection
T02	Page inconnue	Erreur 404
T03	Dashboard sans connexion	Accès refusé
T04	Calendrier sans connexion	Accès refusé
T05	Réservation sans connexion	Redirection login
T06	Création créneau sans connexion	Accès refusé
T07	Inscription email invalide	Message d’erreur
T08	Mots de passe différents	Message d’erreur
T09	Réservation vide	Refus
T10	Mot de passe oublié email invalide	Message d’erreur
Tests manuels complémentaires
création d’un compte client ;
connexion client ;
réservation réelle ;
réception des e-mails ;
annulation client ;
connexion praticienne ;
création de créneau ;
déplacement de rendez-vous ;
blocage journée ;
duplication journée ;
test mobile.