# Mes 14 repas

Petite application web pour composer 14 repas par semaine à partir de catégories à quotas (volaille, légumineuses, poisson maigre, poisson gras, viande rouge, plaisirs allégés, végétarien), avec recettes, ingrédients ajustables en nombre de portions, et génération d'une liste de courses cumulée.

## Utilisation

Ouvrir `index.html` via un serveur web (voir ci-dessous), choisir des plats dans l'onglet **Choisir** ou utiliser **Tirer la semaine** pour un tirage aléatoire respectant les quotas, ajuster le nombre de portions de chaque repas dans l'onglet **Ma semaine**, puis récupérer la liste de courses cumulée dans l'onglet **Courses**.

La sélection de la semaine est sauvegardée dans le navigateur (`localStorage`), donc elle reste disponible si on ferme et rouvre l'application.

## Pourquoi un serveur web et pas juste double-cliquer sur le fichier

Les données des repas sont dans `meals.json`, chargé via `fetch()`. La plupart des navigateurs bloquent ce type de requête pour des raisons de sécurité quand la page est ouverte directement depuis le disque (`file://`). Il faut donc servir les fichiers via http, soit en ligne (GitHub Pages), soit en local.

### Tester en local

Depuis le dossier du projet :

```
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000` dans le navigateur.

### Héberger sur GitHub Pages

1. Créer un dépôt GitHub et y pousser ces fichiers.
2. Dans les paramètres du dépôt, section Pages, choisir la branche principale comme source.
3. L'application est alors accessible à une adresse du type `https://nom-utilisateur.github.io/nom-du-depot/`.
4. Cette adresse peut être ajoutée à l'écran d'accueil sur téléphone (Safari : partager puis "Sur l'écran d'accueil" ; Chrome Android : menu puis "Ajouter à l'écran d'accueil").

## Étendre la liste de repas

Tous les plats sont dans `meals.json`, organisés par catégorie. Chaque catégorie a un quota hebdomadaire (la somme des quotas doit toujours faire 14). Chaque plat a un nom, un bénéfice nutritionnel, un prix par portion, une liste d'ingrédients structurés (nom, quantité, unité) et une recette en étapes. Pour ajouter un plat, ajouter un objet dans le tableau `meals` de la catégorie concernée en suivant le même format.

## Structure des fichiers

- `index.html` : structure de la page
- `style.css` : styles
- `app.js` : logique de l'application
- `meals.json` : données des catégories et des plats
