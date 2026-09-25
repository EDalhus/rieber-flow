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

Sjåførappen bygges i et eget prosjekt/repo og bruker **samme data** via denne Workerens API (`GET /api/sjafor` (SO-er inkluderer `linjer`: bulk/bigbag/pall), `POST /api/lasteplan/:stegId/ferdig`, `POST /api/salgsordrer/:id/ferdig`). D1 kan ikke nås direkte fra en app, så Worker-API-et er den delte kontrakten. CORS er åpent for `/api/*`.

## Personlig dashboard

Dashboardet er et tett 12-kolonners rutenett med **standardiserte widget-størrelser**: bredde 3/6/9/12 og høyde 3 eller 6 rader. Hver widget har størrelsene **S/M/L** som viser mer eller mindre informasjon. **Tilpass dashboard** lar brukeren dra widgets (rekkefølge), velge S/M/L, fjerne og legge til. Rutenettet pakkes automatisk (`grid-auto-flow: dense`), og **🧹 Rydd opp** ordner og tilpasser størrelsene så det ikke blir tomme ruter ([web/src/pakking.ts](web/src/pakking.ts)). Oppsettet lagres per bruker i D1 (`DashboardLayout`) via `GET/PUT/DELETE /api/meg/dashboard`.

- **Tilgjengelige widgets** (legg til via «Tilpass dashboard»): Neste båt (mini-kart med fart, sjøvei og tid igjen – krever at båtanløpet er koblet til AIS), Bemanning i dag, Lager mot åpne ordrer, Siste anløp i kaiboken, Vær ved terminalen ([MET Norway](https://api.met.no/), cachet i 10 min), Lasteplaner og Hurtigvalg.
- **AIS-kobling for anløp:** koble et båtanløp til et fartøy (søk på navn/IMO/MMSI) når du oppretter det, eller via «📡 Koble til AIS» på lasteplan-siden.
- **Ny widget:** legg til én oppføring i `WIDGETS` i [web/src/widgets.tsx](web/src/widgets.tsx) med `storrelser` (f.eks. `{ S: [3, 3], M: [3, 6] }`) og en komponent som tar `s` – den dukker automatisk opp under «Legg til widget».
- **Innlogging:** identiteten hentes fra Cloudflare Access (`Cf-Access-Authenticated-User-Email`) når det er slått på (Zero Trust → Access → legg Worker-en bak en policy). Uten Access velger man demo-bruker i toppfeltet (`X-Demo-User`) – dette kan forfalskes og er kun til demo.

## Flåte & kart (AIS fra Kystverket via Barentswatch)

Fanen **Flåte & kart** viser et kart over Norge (Kartverket) der bare båtene i *din* flåte vises. Flåten lagres per bruker i D1 (`Flate`). Legg til båter via søk (skipsnavn/MMSI) eller fra båtanløpene; klikk en båt for detaljer og siste 24 timers spor.

**Ekte AIS-data:**
1. Registrer en **AIS-klient** på [barentswatch.no/minside](https://www.barentswatch.no/minside/) (velg «AIS-client»).
2. Sett hemmelighetene på Worker-en: `npx wrangler secret put BARENTSWATCH_CLIENT_ID` og `... BARENTSWATCH_CLIENT_SECRET` (eller Cloudflare Dashboard → Worker → Settings → Variables and Secrets). Lokalt: kopier `.dev.vars.example` til `.dev.vars`.

**Feilsøking:** trykk «Test AIS-tilkobling» på Flåte-siden (eller åpne `/api/ais/status`). Nøklene må ligge som *Variables and Secrets* på selve Worker-en (Settings), ikke som «Build»-variabler – og Worker-en må deployes på nytt etter at de er lagt inn.

Kartet viser **kun ekte AIS-data** – uten nøkler er det tomt, og flåten starter tom: du legger til dine egne båter via søket. Dekning: norsk økonomisk sone, Svalbard og Jan Mayen; fiskefartøy under 15 m og fritidsbåter under 45 m er ikke med. Se [Barentswatch AIS-dokumentasjon](https://developer.barentswatch.no/docs/AIS/live-ais-api).

### Sjøvei til terminalen, ringer og båtkort

- **Sjøvei (ikke luftlinje):** `web/public/sjovei-a.bin.gz` (hele kysten, 500 m celler) og `sjovei-b.bin.gz` (detaljvindu rundt Ålesund, 50 m celler) er forhåndsberegnede avstandsfelt fra terminalen på **Flatholmen havn 81B, Ålesund** (62,4792 N, 6,1929 Ø – Geonorge adresse-API) til alle sjøceller. Sjø/land kommer fra **Kartverkets kartdata** (WMS `topo`: N250/N50 Vannflate), med Natural Earth som reserve utenfor Kartverkets dekning. Ruta følger fallet i feltet og forenkles uten at en rett strekning krysser land. Nettleseren gjør oppslaget uten serverkall.
  Bygges på nytt med `scripts/sjovei/` (tre trinn – se toppen av `lag-maske.py`, `hent-kartverket.py`, `beregn.mjs`; detaljvinduet tar ca. 10 min). Det er et estimat: rutenettet følger ikke offisielle farleder, dybde eller trafikkseparasjon.
- **Ringer:** velg en båt for å se ringer for 15 min, 30 min, 1 t og 2 t ved gjeldende fart (ligger båten stille vises faste avstander). Kartet viser navn og fart ved hver båt.
- **Båtkort:** live AIS-data, sjøvei/ETA til terminalen og **felles kontaktinfo** (rederi, kaptein/chief med klikkbare telefonnumre, e-post, agent, VHF, kapasitet, notater) som alle kan redigere (`/api/fartoy/:mmsi`).
- **Bilder:** Kystverkets AIS-API har ingen bilder (NAIS henter dem fra ship-info.com, som ikke har åpent API). Man laster derfor opp egne bilder (nyeste blir hovedbilde), eller legger inn en https-lenke.

## Produktkatalog (Admin)

Siden **Admin** administrerer produktene (SKU-er) – **bulk** (tonn), **bigbags** (antall, vekt pr. bigbag) og **pallevarer** (antall paller, f.eks. 40 × 25 kg). Hvert produkt har produkt-ID/nummer (unikt), navn, beskrivelse, farge (brukes i ordrelister og sjåførappen) og lagerbeholdning. Ordrelinjer refererer til produkter, og lageret trekkes automatisk når en ordre/et lastesteg er ferdig. Produkter som er brukt i ordrer kan ikke slettes (deaktiver dem), og type/vekt låses. Bare roller *Formann*, *Kontor* og *Ledelse* kan endre katalogen; andre har lesetilgang (`/api/admin/produkter`, `/api/produkter`).

Databaser fra før produktkatalogen migreres automatisk ved første kall (`db/migrasjon-produkter.sql`): demo-båtene, demo-ordrene og salttypene fjernes, mens egne båtanløp, flåte, kaibok og kalender beholdes.

## Kaibok og kalender

- **Kaibok** (`/api/kaibok`): en føring pr. anløp med båtnavn, dato til kai, lasting/lossing, bulk/pallevarer/begge, tonn, vurdering (Bra/Merknad/Avvik), tilbakemelding og bilder. Filtrer på båt (alle anløp for samme båt), operasjon, vare, vurdering, dato og fritekst. Når en båt er ferdig lastet opprettes føringen automatisk, klar for tilbakemelding.
- **Bilder** krympes i nettleseren og lagres som base64 i D1 (`KaibokBilder`, maks ~1,2 MB pr. bilde). Ved reell bruk bør de flyttes til R2.
- **Kalender** (`/api/kalender`, `/api/fravaer`): måned- og listevisning med båtanløp (kommende og historikk) og alles fravær. Hver dag viser bemanning (`på jobb / totalt`) og hvem som ikke kan jobbe overtid. Man kan bare endre og slette egne fravær.

## Demo-flyt

1. **Dashboard:** on-hand pr. salttype, produksjon og salg.
2. **Båtanløp → MV Arctic Breeze:** dra ledige salgsordrer inn i lasteplanen og sorter dem til Steg 1, 2, 3 …
3. **▶ Start lasting:** appen bytter automatisk til båt-modus og viser kun gjeldende steg.
4. Sjåførappen: hold inne **FERDIG**: steget forsvinner, neste popper opp, progress bar og lager oppdateres live på kontoret.
5. **SO-kø:** lastebilordrer sortert på kortest frist.

## API (utdrag)

`GET /api/dashboard` · `GET/POST /api/batanlop` · `GET /api/batanlop/:id` · `PUT /api/batanlop/:id/lasteplan` · `POST /api/batanlop/:id/start` · `POST /api/lasteplan/:stegId/ferdig` · `GET /api/so-ko` · `CRUD /api/salgsordrer` · `GET /api/sjafor` (SO-er inkluderer `linjer`: bulk/bigbag/pall)

> MVP har ingen innlogging – ikke eksponer med ekte data uten å legge Cloudflare Access foran.
