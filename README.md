# PWA Licence — SYDONIA Control

Console de pilotage des licences et installations SYDONIA. Dossier **autonome** : aucun autre dossier n'est nécessaire.
Indépendante du Portail DGDA et de la Vérification QR.

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | Interface et logique |
| `config.js` | URL `/exec` du pilote **Licence** (aucun secret) |
| `manifest.webmanifest`, `service-worker.js` | Installation PWA, hors-ligne de l'interface, mise à jour automatique |
| `assets/` | Icônes (192/512, maskable, apple-touch, favicons) et logos 64/128 |
| `.nojekyll` | Indispensable pour GitHub Pages |

## Configuration
`config.js` → `apiUrl` = URL `/exec` du déploiement Apps Script **Licence**. Le champ « Configuration » de l'écran permet de la remplacer
dans ce navigateur seulement ; ce remplacement n'est retenu que si `configVersion` est identique (changer `configVersion` invalide toutes les URL mémorisées).

Le champ « Jeton administrateur » est obligatoire pour charger les installations et modifier les licences. Il est conservé uniquement dans
`sessionStorage` du navigateur. Dans Apps Script, définir la propriété de script `LICENSE_ADMIN_TOKEN` avec la même valeur, puis redéployer le
pilote Licence. Ne jamais placer ce jeton dans `config.js`, GitHub ou le ZIP public.

## Essai local
```
cd PWA/LICENCE
python -m http.server 8080      # puis http://localhost:8080
```
(`localhost` est un contexte sécurisé : le service worker et l'installation PWA fonctionnent.)

## Mise à jour
Interface servie **réseau d'abord** : une nouvelle publication est vue au rechargement suivant, et l'application se recharge seule une fois quand
le nouveau service worker prend la main. Pour forcer le renouvellement du cache : changer `VERSION` dans `service-worker.js` et `?v=` dans `index.html`.

## Diagnostic
Ouvrir les outils de développement → Console : chaque échec d'appel Apps Script y est écrit avec sa cause réelle (préfixe `[SYDONIA]`).
Si l'écran affiche « Réponse invalide », l'URL `/exec` est fausse ou le déploiement n'est pas « Tout le monde ».
