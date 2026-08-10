# Documentation Technique — MBA Green Rapports

**Date :** 7 août 2026
**Version :** 2.0 (remplace la doc du 7 août rédigée sur l'état cassé du code)
**Application :** mba-green-rapports (Next.js 15 + TypeScript + React 19)
**Production :** https://mba-green-rapports.vercel.app (projet Vercel `mba-green-rapports`, team `ndimitrescu-commits-projects`, auto-déploiement sur push `main`)

---

## Historique important (à lire avant toute modification)

Le 7 août 2026, une série de correctifs automatiques (commits `4def6c8`→`d3d2a6d`)
a progressivement **remplacé le code réel par des stubs** en essayant de corriger
des erreurs de build :

- `lib/renderDesignPdf.ts` : template complet de 1 585 lignes → stub de 230 lignes
- `lib/netsuiteData.ts`, `lib/netsuiteFinancials.ts`, `lib/googleSheets.ts` : intégrations réelles → stubs vides
- `lib/supabaseLogistics.ts` : requêtes réécrites sur une colonne `date_commande`
  qui **n'existe pas** dans Supabase (les tables `shipments` et `gls_parcels`
  n'ont que `date_depart` / `date_livraison_*`)

Le commit `3a0f022` (« Restauration du code complet ») est reparti du dernier
état sain (`e488a74`) et a appliqué proprement les 4 corrections Krousty.
**Ne jamais réappliquer les patchs du dossier `_to_delete/`.**

---

## Architecture

```
Next.js 15 (App Router)
  ├── app/page.tsx          Génération directe du PDF (client + mois)
  ├── app/preview/          Aperçu + ÉDITION des valeurs avant génération
  ├── app/prevision/        Table Supabase `forecasts` éditable
  ├── app/rfa/              Taux RFA/commissions (table `rfa_rates`)
  └── app/api/
      ├── generate          POST {client, month_label, context?} → PDF
      ├── context           POST {client, month_label} → JSON éditable
      ├── prevision(+import), rfa, commissions, chat
```

### Sources de données (lib/)
| Module | Source | Rôle |
|---|---|---|
| `supabaseLogistics.ts` | Supabase `shipments`, `gls_parcels` | GEODIS/GLS live (filtre `date_depart`, rattachement client par nom de restaurant) |
| `netsuiteFinancials.ts` | NetSuite SuiteQL (TBA OAuth 1.0a) | CA HT, règlements par terme, nb commandes ; sémaphore 3 req max + retry 429 |
| `netsuiteData.ts` | NetSuite SuiteQL | Consommation cartons (factures), prix catalogue/moyen, stock, transit |
| `googleSheets.ts` | Google Sheets (service account) | Prévisionnel + prix (repli si table `forecasts` vide) |
| `forecastsDb.ts` / `rfaRates.ts` | Supabase (service role) | Prévisions et taux RFA gérés dans l'app |
| `parsers.ts` | Fichiers GEODIS/GLS uploadés | Ancien pipeline fichier (toujours fonctionnel) |
| `compute.ts` | — | Assemble le ReportContext ; **chaque source est encapsulée dans `safe()`** : une panne = section à « - », jamais d'erreur 500 |
| `renderDesignPdf.ts` | — | Rendu PDF (pdf-lib). 2 gabarits : `standard` (12 p. — Pokawa, Lüks, Kazdalerie) et `compact` (8 p. — Krousty, Black & White) |

### Clients (lib/clients.json)
POKAWA (standard), KROUSTY (compact), BLACK_WHITE (compact), LUKS_KEBAB
(standard), KAZDALERIE (standard). Black & White **est** dans clients.json
(netsuite_parent_id 194089).

---

## Les 4 corrections Krousty (appliquées, commit 3a0f022)

1. **Pagination** — `renderCompact()` numérote dynamiquement (couverture = p.1
   non numérotée, puis compteur `num++`). Fini les pages 02,03,06,07,08,09 et
   les pages « 04/05 manquantes ».
2. **Cartons** — le comptage GEODIS reste `nb_colis`, avec repli sur la
   référence `SOxxxxx - N COLIS` (envois palettisés où nb_colis = 0). Le fix
   « date_commande » était impossible (colonne inexistante). Voir « Questions
   ouvertes » pour l'écart 1991 vs 2010.
3. **Livraisons conformes** — avant 12h OU après 14h (exclut le service de
   midi), calculées dans `computeGeodisResult()` sur l'heure réelle de
   livraison (`respect_horaires_conformes`, + `horaires.conformes`).
   Vérifié en prod : Krousty juillet 2026 = **93/114 (81,6 %)**.
4. **Pages manquantes** — conséquence du n°1, résolu par le même fix.

Test du pipeline sans serveur : `npx tsx scripts/test-report.ts CLIENT "Mois
Année" geodis.json gls.json out.pdf` (lignes JSON exportées de Supabase).

---

## Variables d'environnement

Toutes provisionnées sur le projet Vercel (Production + Preview) :
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NETSUITE_ACCOUNT_ID`, `NETSUITE_CONSUMER_KEY`,
`NETSUITE_CONSUMER_SECRET`, `NETSUITE_TOKEN_ID`, `NETSUITE_TOKEN_SECRET`,
`GOOGLE_SERVICE_ACCOUNT_KEY_B64`, `GOOGLE_FORECAST_SHEET_ID`,
`RFA_ADMIN_PASSWORD`.

En local : copier `env.local.example` → `.env.local` et compléter. Sans les
clés NetSuite/Google, le rapport se génère quand même (sections à « - »).

---

## Questions ouvertes / pistes

1. **« Cartons facturés » 1991 vs 2010 (Krousty juillet).** Le 1991 vient de
   NetSuite (`fetchConsumptionCartons`, factures `CustInvc` par `trandate` du
   mois). La référence Excel attendait 2010. Piste : compter sur les **Sales
   Orders** du mois plutôt que les factures (une commande fin juillet facturée
   début août sort du compte actuel). À valider sur NetSuite avant de changer.
   En attendant, la valeur est éditable dans `/preview` avant génération.
2. **Ingestion GLS incomplète.** `gls_parcels` n'a que 16 colis Krousty en
   juillet 2026 — suspicieusement bas. À vérifier côté worker Railway GLS.
3. **`GOOGLE_FORECAST_SHEET_ID`** (Vercel) n'est pas lu par le code, qui
   attend `PREVISIONNEL_SHEET_ID` / `DEMAND_PLANNING_SHEET_ID` (avec IDs par
   défaut codés en dur — fonctionne donc quand même).
