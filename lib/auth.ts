/**
 * lib/auth.ts
 * ===========
 * Constante partagée par middleware.ts (porte d'entrée unique de l'outil)
 * et app/api/login/route.ts — décision Nicolas (09/09/2026) : un seul mot
 * de passe, saisi une fois en entrant dans l'outil, plus de repli par
 * onglet. Isolée ici (plutôt qu'importée depuis middleware.ts) pour ne pas
 * coupler des routes normales au fichier spécial de middleware.
 */
export const AUTH_COOKIE_NAME = "mba_auth";
