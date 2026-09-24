# Rieber Flow

Skybasert logistikkverktøy for havneterminalen (MVP / demo). Kontoret planlegger båtlaster i web-panelet, hjullastersjåføren får en idiotsikker «Kjøre-modus» i lomma.

- **Backend + web:** én Cloudflare Worker ([src/](src)) med Hono-API, Cloudflare D1 og statiske web-filer (Vite + React, [web/](web)).
- **Mobil:** eget repo (se under).
- **Mock-data:** alt ligger i D1 ([db/schema.sql](db/schema.sql), [db/seed.sql](db/seed.sql)). Ingen integrasjoner (Dynamics 365, Scale IT, NAIS) i MVP-en.

## Deploy til Cloudflare (Workers Builds fra GitHub)

1. Cloudflare Dashboard → **Workers & Pages → Create → Import a repository** → velg dette repoet.
2. Build command: `npm run build` · Deploy command: `npx wrangler deploy` (rot-mappen).
3. Ferdig. D1-databasen `rieber-flow-db` opprettes automatisk ved første deploy, og schema + mock-data legges inn ved første API-kall.

> Hvis auto-opprettelse av D1 ikke fungerer på kontoen din: `npx wrangler d1 create rieber-flow-db`, og legg `database_id` inn i [wrangler.jsonc](wrangler.jsonc).

Manuelt: `npm install && npm run deploy`.

## Lokal utvikling

```bash
npm install
npm run dev          # bygger web + kjører Worker og lokal D1 på http://localhost:8787
```

Nullstill demodata: knappen «Nullstill demo» i web-panelet, eller `POST /api/admin/reset`.

## Mobilapp (eget repo)

Sjåførappen bygges i et eget prosjekt/repo og bruker **samme data** via denne Workerens API (`GET /api/sjafor`, `POST /api/lasteplan/:stegId/ferdig`, `POST /api/salgsordrer/:id/ferdig`). D1 kan ikke nås direkte fra en app, så Worker-API-et er den delte kontrakten. CORS er åpent for `/api/*`.

## Demo-flyt

1. **Dashboard:** on-hand pr. salttype, produksjon og salg.
2. **Båtanløp → MV Arctic Breeze:** dra ledige salgsordrer inn i lasteplanen og sorter dem til Steg 1, 2, 3 …
3. **▶ Start lasting:** appen bytter automatisk til båt-modus og viser kun gjeldende steg.
4. Sjåførappen: hold inne **FERDIG**: steget forsvinner, neste popper opp, progress bar og lager oppdateres live på kontoret.
5. **SO-kø:** lastebilordrer sortert på kortest frist.

## API (utdrag)

`GET /api/dashboard` · `GET/POST /api/batanlop` · `GET /api/batanlop/:id` · `PUT /api/batanlop/:id/lasteplan` · `POST /api/batanlop/:id/start` · `POST /api/lasteplan/:stegId/ferdig` · `GET /api/so-ko` · `CRUD /api/salgsordrer` · `GET /api/sjafor`

> MVP har ingen innlogging – ikke eksponer med ekte data uten å legge Cloudflare Access foran.
