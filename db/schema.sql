-- Rieber Flow – Cloudflare D1 schema
-- Kjøres på nytt ved reset (DROP først), så seed er idempotent.


DROP TABLE IF EXISTS FartoyBilde;
DROP TABLE IF EXISTS FartoyInfo;
DROP TABLE IF EXISTS KaibokBilder;
DROP TABLE IF EXISTS Kaibok;
DROP TABLE IF EXISTS Fravaer;
DROP TABLE IF EXISTS Flate;
DROP TABLE IF EXISTS DashboardLayout;
DROP TABLE IF EXISTS Brukere;
DROP TABLE IF EXISTS BatLasteplan;
DROP TABLE IF EXISTS SalgsordreLinjer;
DROP TABLE IF EXISTS Salgsordrer;
DROP TABLE IF EXISTS Batanlop;
DROP TABLE IF EXISTS Oppsett;
DROP TABLE IF EXISTS Produkter;

-- Produktkatalog (SKU-er): bulk, bigbags og pallevarer. Administreres på Admin-siden.
--   Bulk:   lager og ordrelinjer i tonn (kg_per_enhet = 1000, enhet 'tonn')
--   Bigbag: lager og ordrelinjer i antall bigbags (kg_per_enhet = vekt pr. bigbag)
--   Pall:   lager og ordrelinjer i antall paller (kg_per_enhet = vekt pr. pall, enhet f.eks. '40 × 25 kg')
CREATE TABLE Produkter (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  produktnr     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  navn          TEXT NOT NULL,
  beskrivelse   TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL CHECK (type IN ('Bulk', 'Bigbag', 'Pall')),
  enhet         TEXT NOT NULL,
  kg_per_enhet  REAL NOT NULL CHECK (kg_per_enhet > 0),
  pallertype    TEXT,                          -- kun for Pall: 'Europalle' eller 'SRS plastpalle'
  fargekode     TEXT NOT NULL DEFAULT '#1E6FFF',
  lager         REAL NOT NULL DEFAULT 0 CHECK (lager >= 0),
  aktiv         INTEGER NOT NULL DEFAULT 1,
  opprettet     TEXT NOT NULL
);
CREATE INDEX idx_produkt_type ON Produkter(type);

-- Båtanløp (senere hentet fra NAIS Kystverket; mmsi er nøkkelen dit).
CREATE TABLE Batanlop (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  skipsnavn   TEXT NOT NULL,
  mmsi        TEXT,
  eta         TEXT NOT NULL,                  -- ISO 8601 UTC
  status      TEXT NOT NULL DEFAULT 'Ventet'
              CHECK (status IN ('Ventet', 'Ankommet', 'Lasting', 'Ferdig'))
);

-- Salgsordrer. batanlop_id = NULL betyr vanlig lastebil-ordre (SO-køen).
CREATE TABLE Salgsordrer (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ordrenummer  TEXT NOT NULL UNIQUE,
  kunde        TEXT NOT NULL,
  tonn         REAL NOT NULL CHECK (tonn > 0),
  frist        TEXT NOT NULL,                 -- ISO 8601 UTC
  status       TEXT NOT NULL DEFAULT 'Ny'
               CHECK (status IN ('Ny', 'Planlagt', 'Under lasting', 'Ferdig')),
  batanlop_id  INTEGER REFERENCES Batanlop(id) ON DELETE SET NULL,
  ferdig_tidspunkt TEXT                       -- når ordren ble levert (til statistikk)
);
CREATE INDEX idx_so_frist ON Salgsordrer(frist);
CREATE INDEX idx_so_batanlop ON Salgsordrer(batanlop_id);

-- Låst lastesekvens pr. båt. Steg-status styrer "auto-skjuling" i appen.
CREATE TABLE BatLasteplan (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  batanlop_id       INTEGER NOT NULL REFERENCES Batanlop(id) ON DELETE CASCADE,
  so_id             INTEGER NOT NULL UNIQUE REFERENCES Salgsordrer(id) ON DELETE CASCADE,
  rekkefolge_nummer INTEGER NOT NULL CHECK (rekkefolge_nummer > 0),
  status            TEXT NOT NULL DEFAULT 'Venter'
                    CHECK (status IN ('Venter', 'Aktiv', 'Ferdig')),
  ferdig_tidspunkt  TEXT,
  UNIQUE (batanlop_id, rekkefolge_nummer)
);

-- Hva som ligger i en SO: produkt (SKU) og antall. Bulk i tonn, bigbags/paller i antall.
-- Totalvekt (kg) = antall * Produkter.kg_per_enhet. Bigbag/Pall må klargjøres/plukkes; Bulk lastes direkte.
CREATE TABLE SalgsordreLinjer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  so_id         INTEGER NOT NULL REFERENCES Salgsordrer(id) ON DELETE CASCADE,
  produkt_id    INTEGER NOT NULL REFERENCES Produkter(id),
  antall        REAL NOT NULL CHECK (antall > 0)
);
CREATE INDEX idx_linje_so ON SalgsordreLinjer(so_id);

-- Brukere. Identiteten kommer fra Cloudflare Access (e-post) når det er slått på;
-- ellers velger demoen bruker i toppfeltet.
CREATE TABLE Brukere (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  epost   TEXT NOT NULL UNIQUE,
  navn    TEXT NOT NULL,
  rolle   TEXT NOT NULL DEFAULT 'Kontor'
);

-- Personlig dashboard-oppsett (react-grid-layout: [{i, x, y, w, h}]). Ingen rad = standardoppsett.
CREATE TABLE DashboardLayout (
  bruker_id   INTEGER PRIMARY KEY REFERENCES Brukere(id) ON DELETE CASCADE,
  layout      TEXT NOT NULL,                  -- JSON
  oppdatert   TEXT NOT NULL
);

-- Brukerens flåte: båtene (MMSI) som vises på kartet. Alle andre AIS-fartøy holdes utenfor.
CREATE TABLE Flate (
  bruker_id   INTEGER NOT NULL REFERENCES Brukere(id) ON DELETE CASCADE,
  mmsi        TEXT NOT NULL,
  navn        TEXT NOT NULL,
  lagt_til    TEXT NOT NULL,
  PRIMARY KEY (bruker_id, mmsi)
);

-- Kaibok: én føring pr. båtanløp ved kai (kan også føres manuelt for eldre anløp).
CREATE TABLE Kaibok (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batanlop_id    INTEGER REFERENCES Batanlop(id) ON DELETE SET NULL,
  baatnavn       TEXT NOT NULL,
  mmsi           TEXT,
  kai_dato       TEXT NOT NULL,               -- YYYY-MM-DD
  operasjon      TEXT NOT NULL CHECK (operasjon IN ('Lasting', 'Lossing')),
  varetype       TEXT NOT NULL CHECK (varetype IN ('Bulk', 'Pallevarer', 'Begge')),
  tonn           REAL,
  vurdering      TEXT NOT NULL DEFAULT 'Ikke vurdert' CHECK (vurdering IN ('Bra', 'Merknad', 'Avvik', 'Ikke vurdert')),
  tilbakemelding TEXT NOT NULL DEFAULT '',
  opprettet_av   INTEGER REFERENCES Brukere(id) ON DELETE SET NULL,
  opprettet      TEXT NOT NULL
);
CREATE INDEX idx_kaibok_dato ON Kaibok(kai_dato);
CREATE INDEX idx_kaibok_baat ON Kaibok(baatnavn);
CREATE UNIQUE INDEX idx_kaibok_anlop ON Kaibok(batanlop_id) WHERE batanlop_id IS NOT NULL;

-- Bilder som dokumenterer kvalitet. MVP: lagres som base64 i D1 (bildene krympes i nettleseren).
-- Ved videre bruk bør de flyttes til R2.
CREATE TABLE KaibokBilder (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  foering_id   INTEGER NOT NULL REFERENCES Kaibok(id) ON DELETE CASCADE,
  filnavn      TEXT NOT NULL,
  content_type TEXT NOT NULL,
  storrelse    INTEGER NOT NULL,
  data         TEXT NOT NULL,
  opplastet    TEXT NOT NULL
);
CREATE INDEX idx_bilder_foering ON KaibokBilder(foering_id);

-- Fravær og avtaler i kalenderen. Tid = NULL betyr hel dag. Datoene er inklusive.
CREATE TABLE Fravaer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bruker_id     INTEGER NOT NULL REFERENCES Brukere(id) ON DELETE CASCADE,
  kategori      TEXT NOT NULL CHECK (kategori IN ('Lege/tannlege', 'Verksted/bil', 'Skole/barn', 'Ferie', 'Sykdom', 'Annet', 'Ikke overtid')),
  tittel        TEXT NOT NULL DEFAULT '',
  dato_fra      TEXT NOT NULL,
  dato_til      TEXT NOT NULL,
  tid_fra       TEXT,                         -- HH:MM
  tid_til       TEXT,
  ikke_overtid  INTEGER NOT NULL DEFAULT 0,
  opprettet     TEXT NOT NULL
);
CREATE INDEX idx_fravaer_dato ON Fravaer(dato_fra, dato_til);

-- Felles, brukerstyrt info om en båt (nøkkel = MMSI) – kontaktinfo og annet som er kjekt å ha for hånden.
CREATE TABLE FartoyInfo (
  mmsi           TEXT PRIMARY KEY,
  rederi         TEXT NOT NULL DEFAULT '',
  kaptein_navn   TEXT NOT NULL DEFAULT '',
  kaptein_tlf    TEXT NOT NULL DEFAULT '',
  chief_navn     TEXT NOT NULL DEFAULT '',
  chief_tlf      TEXT NOT NULL DEFAULT '',
  epost          TEXT NOT NULL DEFAULT '',
  agent_navn     TEXT NOT NULL DEFAULT '',
  agent_tlf      TEXT NOT NULL DEFAULT '',
  vhf_kanal      TEXT NOT NULL DEFAULT '',
  kapasitet      TEXT NOT NULL DEFAULT '',
  bilde_url      TEXT NOT NULL DEFAULT '',
  notater        TEXT NOT NULL DEFAULT '',
  oppdatert      TEXT NOT NULL,
  oppdatert_av   INTEGER REFERENCES Brukere(id) ON DELETE SET NULL
);

-- Egne bilder av båten. Hovedbildet (hoved=1) vises i båtkortet. Lagres som base64 (som kaibok-bildene).
CREATE TABLE FartoyBilde (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mmsi          TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  storrelse     INTEGER NOT NULL,
  data          TEXT NOT NULL,
  hoved         INTEGER NOT NULL DEFAULT 0,
  opplastet     TEXT NOT NULL
);
CREATE INDEX idx_fartoybilde_mmsi ON FartoyBilde(mmsi);

-- Interne flagg (f.eks. at demo-data er ryddet bort).
CREATE TABLE Oppsett (
  nokkel  TEXT PRIMARY KEY,
  verdi   TEXT NOT NULL
);
