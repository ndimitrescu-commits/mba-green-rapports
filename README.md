# MBA Green Rapports — API Python

API minimale qui calcule les KPIs mensuels d'un rapport client à partir des 5 fichiers sources.

Conçue pour être appelée par **Make** (ou Zapier, n8n, etc.) dans une architecture hybride :

```
Fichiers Pokawa ──> API Python ──> Google Sheets ──> Google Slides ──> PDF
(Drive upload)      (Railway)       (pivot)           (template)         (Gmail/Drive)
                                    orchestré par Make
```

## Un seul endpoint

**`POST /compute`** : prend les 5 fichiers + les données manuelles, retourne ~80 KPIs en JSON.

Tous les KPIs sont retournés dans un format directement utilisable comme balises Slides `{{nom_du_kpi}}`.

## Démarrer en local

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export API_KEY="test123"
uvicorn app.main:app --reload --port 8000
```

Tester :
```bash
curl http://localhost:8000/health
# → {"status":"ok"}

curl http://localhost:8000/clients
# → {"pokawa":"Pokawa"}
```

## Déployer sur Railway

### 1. Créer un repo GitHub

```bash
cd mbagreen_api
git init
git add .
git commit -m "Initial API MBA Green"
# Créer un repo sur github.com puis:
git remote add origin git@github.com:TON_ORG/mbagreen-api.git
git push -u origin main
```

### 2. Déployer

1. Va sur https://railway.app → **New Project** → **Deploy from GitHub**
2. Sélectionne le repo `mbagreen-api`
3. Railway détecte Python automatiquement (Procfile + requirements.txt + runtime.txt)

### 3. Variables d'environnement

Dans Railway → Settings → Variables, ajoute :

| Variable | Valeur | Description |
|---|---|---|
| `API_KEY` | `ex: K8mLp2_xY9qR_vN3wF` | Clé secrète (32+ caractères) pour sécuriser l'API |

Générer une clé aléatoire :
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 4. Ouvrir le domaine

Railway → Settings → Networking → **Generate Domain**. Tu auras une URL type :
```
https://mbagreen-api-production.up.railway.app
```

## Utilisation dans Make

### Module HTTP > Make a request

**URL** :
```
https://mbagreen-api-production.up.railway.app/compute
```

**Method** : `POST`

**Headers** :
```
X-API-Key: <valeur de API_KEY>
```

**Body type** : `multipart/form-data`

**Fields** :

| Key | Type | Value |
|---|---|---|
| `client` | text | `pokawa` |
| `month` | text | `Février 2026` |
| `sales` | file | Fichier Commissions Pokawa |
| `articles` | file | POKAWA_DATA_FEB |
| `stock` | file | Client_Report_Breakdown_FEB |
| `geodis` | file | FICHIER_GEODIS |
| `gls` | file | FICHIER_GLSAnnexes (CSV) |
| `commission_stock_pkg` | text | `0` |
| `commission_referencement` | text | `60512.13` |
| `paiement_sepa_30j` | text | `163369.55` |
| `paiement_sepa_45j` | text | `6084.18` |
| `paiement_sepa_escompte_2pct` | text | `41993.52` |
| `paiement_virement_30j` | text | `12867.92` |

**Parse response** : `Yes`

### Sortie : exemple de réponse JSON

```json
{
  "client": "Pokawa",
  "month": "Février 2026",
  "ca_ht": 224315.17,
  "ca_ht_formatted": "224 315,17 €",
  "nb_orders": 528,
  "nb_skus": 31,
  "total_pieces": 2403982,
  "nb_cartons": 4535,
  "ca_forecast": 248166.19,
  "ca_forecast_formatted": "248 166,19 €",
  "performance_rate": 90.39,
  "performance_rate_formatted": "90,39 %",
  "nb_restaurants": 134,
  "split_formatted": "47% / 53%",
  "geodis_nb_orders": 251,
  "geodis_total_weight_formatted": "24 596,53 KG",
  "geodis_pct_before_12h_formatted": "84%",
  "geodis_pct_before_11h_formatted": "67,9%",
  "gls_fr_parcels": 1578,
  "gls_eu_parcels": 253,
  "gls_eu_split": "BE 253",
  "commission_referencement_formatted": "60 512,13 €",
  "articles_lines": [
    {"sku": "BAG01POKOH", "consumption": 679, "performance_pct_formatted": "88%", ...},
    ...
  ],
  "top5_skus": [...],
  "stock_lines": [...]
}
```

## Liste des clés disponibles

**Facteurs clés** :
`ca_ht`, `ca_ht_formatted`, `nb_orders`, `nb_skus`, `total_pieces`, `nb_cartons`, `delivery_success_rate_formatted`

**Performance articles** :
`ca_forecast_formatted`, `ca_actual_formatted`, `performance_rate_formatted`, `articles_lines[]`, `top5_skus[]`

**Logistique** :
`nb_restaurants`, `nb_restaurants_wasabi`, `total_weight_formatted`, `split_geodis_pct`, `split_gls_pct`, `split_formatted`

**GEODIS** :
`geodis_nb_orders`, `geodis_nb_cartons`, `geodis_total_weight_formatted`, `geodis_pct_before_12h_formatted`, `geodis_pct_before_11h_formatted`, `geodis_messagerie_fr_orders`, `geodis_messagerie_fr_delivered`, `geodis_messagerie_eu_orders`, `geodis_messagerie_eu_delivered`, `geodis_messagerie_eu_split`, `geodis_express_orders`, `geodis_express_delivered`, `geodis_affretement_orders`, `geodis_affretement_delivered`

**GLS** :
`gls_nb_orders`, `gls_nb_cartons`, `gls_fr_parcels`, `gls_fr_delivered`, `gls_eu_parcels`, `gls_eu_delivered`, `gls_eu_split`

**Financier** :
`commission_stock_pkg_formatted`, `commission_referencement_formatted`, `paiement_sepa_30j_formatted`, `paiement_sepa_45j_formatted`, `paiement_sepa_escompte_2pct_formatted`, `paiement_virement_30j_formatted`

**Stock** (liste) :
`stock_lines[]` : chaque élément = `{sku, on_hand, weeks, forecasts, stocks, in_transit}`, `stock_weeks[]`

## Coûts Railway

- Plan **Hobby** : 5$/mois — largement suffisant pour 5-10 clients × 12 mois
- L'API utilise ~300 Mo RAM et répond en < 5 sec par appel

## Ajouter un nouveau client

Dans `app/report_engine.py`, section `CLIENTS`, ajouter :

```python
CLIENTS = {
    "pokawa": ClientConfig(...),
    "krousty": ClientConfig(
        name="Krousty",
        geodis_destinataire_pattern=r"KROUSTY",
        gls_reference_pattern=r"Krousty",
        sales_customer_pattern=r"Krousty",
    ),
}
```
