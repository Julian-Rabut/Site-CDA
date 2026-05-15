# Sécurité de l’application

## Authentification

L’application distingue deux espaces :
- espace praticienne ;
- espace client.

Les routes sensibles sont protégées par middleware de session.

## Mots de passe

Les mots de passe sont hashés avec bcrypt avant insertion en base de données.

Aucun mot de passe n’est stocké en clair.

## Sessions

Les sessions utilisent express-session avec :
- cookie httpOnly ;
- sameSite lax ;
- secure activé en production ;
- durée de session limitée.

## Protection brute-force

Les routes sensibles sont protégées par express-rate-limit :
- connexion praticienne ;
- connexion client ;
- mot de passe oublié.

## Base de données

Les requêtes SQL utilisent des paramètres `?`, ce qui limite le risque d’injection SQL.

## Validation des données

Les formulaires clients utilisent express-validator :
- email valide ;
- téléphone contrôlé ;
- mot de passe minimum ;
- confirmation du mot de passe.

## Variables sensibles

Les informations sensibles sont stockées dans `.env` en local et dans les variables d’environnement Railway en production.

## HTTPS

En production, HTTPS est géré par Railway.