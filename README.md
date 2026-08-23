# TRADE-FICTIF-BACKEND

Backend NestJS du simulateur de trading (actions US + crypto, argent fictif). API REST + WebSocket, agent IA Gemini sous garde-fous déterministes, base Turso/libSQL.

> Seul l'argent est fictif. Tout le reste est traité comme réel : slippage systématique, mêmes règles de validation pour l'IA et les ordres manuels, circuit breaker persistant, journal immuable des décisions.

## Stack

- NestJS 11 + TypeScript strict, architecture modulaire idiomatique (modules/controllers/services/guards/DTO)
- Turso / libSQL via `@libsql/client` (requêtes 100% paramétrées)
- Firebase Admin SDK (validation des ID tokens du frontend)
- Gemini via l'**Interactions API** REST (`POST https://generativelanguage.googleapis.com/v1beta/interactions`)
- WebSocket natif (`ws`, protocole brut conforme au contrat) pour la poussée de prix
- Binance WebSocket public (crypto), Yahoo Finance (actions US — API `v8/finance/chart`, **sans clé**)
- class-validator / class-transformer sur toutes les entrées

## Structure

```
src/
  auth/            FirebaseAuthGuard, décorateur @CurrentUser(), FirebaseService
  market-data/     binance.service, yahoo-finance.service, price-cache.service,
                   market-status.service (horaires NYSE + fériés), market-data.service, assets.controller
  prices/          prices.gateway (WS /ws/prices)
  portfolio/       account.service/controller, positions.service/controller
  orders/          orders.service/controller, slippage-engine.service
  ai-agent/        context-engine (étape 1), gemini.service (étape 2),
                   risk-validation.service (étape 3), ai-agent.service (orchestration 5 étapes),
                   ai-agent.controller, risk-validation.service.spec.ts
  database/        database.module, database.service (runner de migrations), migrations/001_init.sql
  common/          interfaces du contrat, api-error, DTO, filtre d'exception, actifs
  scripts/         agent-once.ts (cycle IA manuel)
```

## Setup des clés API

Copier `.env.example` vers `.env` et remplir :

| Variable | Où l'obtenir |
|---|---|
| `GEMINI_API_KEYS` | Jusqu'à **10 clés** Google AI Studio séparées par des virgules, rotation automatique en cas d'échec d'une clé (401/403/429) |
| `GEMINI_API_KEY` | Clé unique — ignoré si `GEMINI_API_KEYS` est rempli |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → Paramètres du projet → Comptes de service → Générer une clé privée → **le JSON complet sur une seule ligne** (utilisez `jq -c .` ou un minifier JSON) |
| `TURSO_DATABASE_URL` | `libsql://<db>-<org>.turso.io` (ou `file:local.db` pour du local pur) |
| `TURSO_AUTH_TOKEN` | `turso db tokens create <db>` (vide si `file:`) |
| `FRONTEND_ORIGIN` | URL exacte du frontend Next.js (CORS restreint, pas de wildcard) |
| `PORT` | défaut 4000 |
| `AI_CYCLE_SECONDS` | période du cycle IA, défaut 60, minimum 5 |

Le démarrage est **fail-fast** : toute variable obligatoire manquante ou JSON Firebase invalide arrête le process avec un message explicite. Les migrations SQL versionnées s'appliquent automatiquement au boot (table `applied_migrations`, scripts rejouables).

## Lancement local

```bash
npm install
npm run start:dev      # http://localhost:4000
npm test               # tests unitaires du risk-validation.service
npm run build && npm run start:prod
```

## Tester l'agent IA manuellement (sans attendre un cycle)

1. **Cycle unique immédiat** (tous comptes actifs) :

```bash
npm run agent:once
```

2. **Cycle permanent rapide** : mettre `AI_CYCLE_SECONDS=5` dans `.env`.

3. **Via API** (token Firebase requis) :

```bash
TOKEN="<firebase_id_token>"

curl -X PUT http://localhost:4000/api/ai/config \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":true,"mode":"propose","watchedSymbols":["BTCUSDT"],"maxPositionSizePercent":2,"dailyLossLimitPercent":3}'

curl http://localhost:4000/api/ai/decisions?limit=10 -H "Authorization: Bearer $TOKEN"
curl http://localhost:4000/api/ai/decisions/<id>/raw -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:4000/api/ai/decisions/<id>/approve -H "Authorization: Bearer $TOKEN"
```

Note : sur les actions US, aucune décision n'est générée hors horaires de marché (9h30–16h00 ET, lun–ven, hors fériés NYSE) — pour tester immédiatement, utiliser un symbole crypto.

## Architecture de l'agent IA (le principe non négociable)

Le LLM n'a **jamais** accès direct à l'exécution. Il produit une intention JSON ; seul du code déterministe décide de l'exécution.

- **Étape 1 — Context Engine** (`context-engine.service.ts`) : prix + indicateurs (RSI14 Wilder, SMA20/50, volatilité, change 24h) calculés en code pur. Marché fermé → abandon sans appel LLM (économie de coûts). Prix non rafraîchissable à <500ms → abandon (`STALE_PRICE_DATA`).
- **Étape 2 — Reasoning** (`gemini.service.ts`) : Interactions API, **stateless** (`store: false`, jamais de `previous_interaction_id`) — choix délibéré : un agent qui tourne des centaines de fois/jour ne doit jamais accumuler du contexte (mode de défaillance type Vending-Bench 2). `thinking_level` : `medium` par défaut, `high` si `|change24h| >= 5%` ou volatilité >= 3%. **Pas de `temperature`** (déconseillé sur Gemini 3). Structured Output via `response_format: {type:'text', mime_type:'application/json', schema}`. Le raisonnement complet est extrait des **thought steps** (`steps[].summary[].text`) et stocké tel quel dans `fullReasoning` — jamais tronqué, jamais résumé. Cas sans thought summary (requête simple) : `fullReasoning` vide, aucun plantage. Timeout 2s sur `gemini-3.7-flash` → fallback `gemini-3.6-flash` (timeout 8s).
- **Rotation de clés Gemini** (`gemini-key-ring.ts`) : jusqu'à 10 clés dans `GEMINI_API_KEYS` (comma-separated). Sur erreur de clé (HTTP 401/403 invalide, 429 quota), la clé fautive passe en cooldown (1h pour 401/403, 60s pour 429) et l'appel est retenté immédiatement sur la clé suivante disponible, même modèle. Toutes les clés épuisées → décision HOLD journalisée `GEMINI_KEYS_EXHAUSTED`. Les timeouts et erreurs 5xx ne déclenchent **pas** la rotation (le problème n'est pas la clé) mais le fallback de modèle. Cohérence de latence : les erreurs de clé répondent vite, la rotation ne s'additionne donc pas aux timeouts 2s/8s.
- **Étape 3 — Risk Validation** (`risk-validation.service.ts`, service pur sans dépendance) : JSON malformé/champ hors bornes → rejet, HOLD par défaut. Position > `maxPositionSizePercent` de l'equity → `POSITION_SIZE_EXCEEDED`. Stop-loss > 10% du spot (20% si volatilité anormale : `|change24h| >= 8%` ou volatilité >= 4%) → rejet. Ticker inconnu ou ≠ symbole analysé → `INVALID_SYMBOL`. Le texte libre (`fullReasoning`, `reasoning_summary`, `key_factors`) n'influence **jamais** la validation — seul le JSON structuré fait foi (surface d'attaque par prompt injection).
- **Étape 4 — Exécution** : validation OK + `mode=autonomous` → ordre créé via le **même** `OrdersService` que les ordres manuels (mêmes guardrails, même moteur de slippage, `source: ai_agent`). `mode=propose` → décision en attente d'approbation humaine (`/approve` revalide tout au prix courant). Validation KO → décision journalisée, aucun ordre, jamais.
- **Étape 5 — Audit** : chaque décision (rejetée ou non) est **INSERT-only** dans `ai_decisions` avec le contexte JSON exact envoyé à Gemini et la réponse Interactions brute complète (tableau `steps` intégral) — consultable via `GET /api/ai/decisions/:id/raw`.

### Circuit breaker

État **persistant** en base (`ai_agent_configs.circuit_breaker_active`). À chaque cycle : P&L journalier (réalisé du jour + latent) <= -(startingBalance × `dailyLossLimitPercent`%) → breaker armé, motif stocké, tout appel IA bloqué **avant** l'étape 1. Réarmement uniquement par intervention explicite : `PUT /api/ai/config {"resetCircuitBreaker": true}`. Une simple mise à jour de config ne le réarme pas.

### Chemins d'erreur explicites (Gemini)

| Cas | Comportement |
|---|---|
| Timeout >2s sur 3.7-flash | Bascule sur 3.6-flash |
| Clé rejetée (HTTP 401/403/429) | Cooldown de la clé + rotation immédiate sur la clé suivante, même modèle |
| Toutes les clés en échec | Décision HOLD journalisée, `validationErrors: ["GEMINI_KEYS_EXHAUSTED"]`, détail des échecs dans `raw_response` |
| Les deux modèles en échec | Décision HOLD journalisée, `validationErrors: ["GEMINI_UNAVAILABLE"]`, réponse d'erreur stockée dans `raw_response` |
| Statut d'interaction ≠ `completed` | Idem chemin échec |
| Sortie non parsable en JSON | Décision HOLD journalisée, `MALFORMED_JSON`, `fullReasoning` conservé si des thought steps existent |
| JSON valide mais sémantiquement absurde | Rejeté à l'étape 3 (revalidation code, jamais confiance dans le schéma côté prompt) |
| Ticker halluciné | `INVALID_SYMBOL` |

## Moteur de slippage

Par actif, bande de slippage selon liquidité simulée : crypto majeure 0.05–0.2%, action liquide 0.02–0.1%, plus large pour les moins liquides (voir `src/common/constants/assets.ts`). Direction systématiquement défavorable au trader (achat → plus haut, vente → plus bas). Le `filledPrice` d'un ordre market n'est **jamais** égal au `requestedPrice`. Cas limite documenté : si le prix de l'actif est si petit que le slippage arrondi s'annule à la précision de cotation, le fill est décalé d'un tick de cotation. Ordres limite : remplis au prix limite uniquement quand le marché l'atteint, avec un délai minimal simulé (5–15s après création, minimum 3s après atteinte — jamais de fill instantané à la microseconde).

## Marché & données de prix

- Crypto : 24/7, Binance WebSocket (`@ticker`, reconnexion auto 5s) + REST de secours.
- Actions : **Yahoo Finance** (endpoint non officiel `query1.finance.yahoo.com/v8/finance/chart`, aucune clé requise — Finnhub a été écarté : captcha bloquant à l'inscription). Polling 30s des 7 actions (~840 req/h, dans les limites raisonnables), horaires NASDAQ/NYSE via `Intl` sur `America/New_York` (aucune heure codée en dur) + table de fériés NYSE 2026–2028 (`market-holidays.ts`, données versionnées à étendre chaque année).
- Fraîcheur 500ms : `getFreshTick` rafraîchit **à la demande** (REST direct) avant chaque ordre/analyse IA ; si le résultat reste >500ms → `STALE_PRICE_DATA` (503).
- Historique : Binance klines (crypto) ; Yahoo candles (actions, `v8/chart` avec interval/range) avec fallback table locale `price_history` alimentée par snapshot minute.

## WebSocket

`WS /ws/prices` (WebSocket natif, protocole texte JSON, public — compatible `new WebSocket()` côté navigateur). Client : envoyer `{"action":"subscribe","symbols":["AAPL","BTCUSDT"]}` ; serveur : pousse un `PriceTick` (JSON) par symbole, throttle 1s par symbole. `{"action":"unsubscribe",...}` pour se désabonner.

## Sécurité

- Ownership systématique : toute ressource (ordre, position, décision IA, config) est filtrée par `account_id` du user authentifié — y compris toutes les routes IA.
- Rate limiting global (300 req/min) + 10 ordres/min sur `POST /api/orders` (`@nestjs/throttler`).
- Aucun secret en dur, fail-fast au démarrage, aucun token Firebase dans les logs.
- Requêtes libSQL 100% paramétrées, aucune concaténation SQL.
- Le solde n'est modifiable que par le moteur d'exécution interne (`executeFill` en transaction) ; aucune route ne touche `balance`/`startingBalance` directement.
- CORS restreint à `FRONTEND_ORIGIN`.
- Erreurs uniformes au format `ApiError` (codes du contrat + `RATE_LIMITED`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `ORDER_NOT_CANCELLABLE`, `ALREADY_PROCESSED`, `DECISION_NOT_APPROVABLE`, `INSUFFICIENT_POSITION`, `LIMIT_PRICE_REQUIRED`, `INTERNAL_ERROR`).

## Décisions d'interprétation (points où le contrat était ambigu — signalés volontairement)

1. **Ordres rejetés vs codes d'erreur** : les erreurs détectables avant création (symbole inconnu, marché fermé, solde insuffisant, position insuffisante, prix périmé) renvoient une `ApiError` avec le code du contrat, sans créer d'ordre. Un ordre créé mais non exécutable au fill (ex. le prix a bougé entre-temps) devient un `Order` avec `status=rejected` et `rejectionReason` rempli — le contrat exigeant les deux mécanismes.
2. **Append-only vs approve** : `ai_decisions` est strictement INSERT-only, or `/approve` doit lier un `resultingOrderId` après coup. Résolution : table annexe `ai_decision_outcomes` (elle aussi INSERT-only) ; l'API fusionne pour exposer `resultingOrderId` sans jamais muter une décision.
3. **Skips d'étape 1** : marché fermé ou prix périmé → pas d'appel LLM → pas de `AiDecision` (ce n'est pas une décision du modèle), simple log serveur. Toute sortie de l'étape 2+ est journalisée, même rejetée ou `GEMINI_UNAVAILABLE`.
4. **Vente à découvert** : non supportée (V1) — SELL exige une position suffisante (`INSUFFICIENT_POSITION`). SL/TP proposés sur un SELL sont ignorés (clôture de position longue).
5. **Stop-loss / take-profit automatiques** : stockés sur l'ordre/position, aucun moteur de déclenchement automatique dans cette version (hors périmètre du contrat de routes).
6. **Statut d'une décision en mode propose** : le contrat `AiDecision` n'expose pas de champ statut ; le frontend déduit « en attente » de `validationPassed && action != HOLD && resultingOrderId == null`. Approuver/rejeter deux fois → `ALREADY_PROCESSED`.
7. **Frontières flottantes** : comparaisons de seuils monétaires/distance avec epsilon (1e-4 $ / 1e-6 %) pour que « exactement à la limite » soit accepté (`> strict` sinon), couvert par les tests unitaires.

## Tests

`npm test` — suites unitaires du `risk-validation.service.ts` (pièce critique : payloads malformés (null, string, tableau, action invalide, types aberrants), ticker halluciné/mauvais, bornes de confiance 0/1 exactes, taille de position exactement à la limite vs juste au-dessus, stop-loss à exactement 10% vs juste au-delà, palier 20% en volatilité anormale, TP ≤ spot, SELL == détenu vs au-delà, HOLD, marché fermé, limite de perte journalière exacte, quantités invalides, normalisations tolérantes) et du `gemini-key-ring.ts` (filtrage, rotation circulaire, single key, cooldowns différenciés par raison, expiration).

À exécuter dans le Codespace (installation et tests réseau interdits en local) : `npm install && npm test && npm run build`.
