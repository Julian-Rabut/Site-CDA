# Sauvegarde et maintenance

## Base de données

La base de données MySQL est hébergée sur Railway.

Une sauvegarde peut être réalisée par export SQL régulier de la base.

## Données sensibles

Les variables sensibles ne sont pas versionnées dans GitHub.

Elles sont stockées :
- dans `.env` en local ;
- dans les variables d’environnement Railway en production.

## Code source

Le code source est versionné avec Git et hébergé sur GitHub.

Chaque évolution importante fait l’objet d’un commit.

## Déploiement

Railway redéploie automatiquement l’application après un push sur GitHub.

## Maintenance prévue

Améliorations possibles :
- sauvegarde SQL automatisée ;
- ajout de tests métier plus complets ;
- amélioration du suivi des erreurs ;
- rappel automatique par e-mail avant rendez-vous.