-- Rieber Flow – Cloudflare D1 schema
-- Kjøres på nytt ved reset (DROP først), så seed er idempotent.


DROP TABLE IF EXISTS Flate;
DROP TABLE IF EXISTS DashboardLayout;
DROP TABLE IF EXISTS Brukere;
DROP TABLE IF EXISTS BatLasteplan;
DROP TABLE IF EXISTS SalgsordreLinjer;
DROP TABLE IF EXISTS Salgsordrer;
DROP TABLE IF EXISTS Batanlop;
DROP TABLE IF EXISTS Varelager;

-- Lagerbeholdning pr. salttype. Fargekoden brukes av både web og app.
CREATE TABLE Varelager (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  salttype        TEXT NOT NULL UNIQUE,
  fargekode       TEXT NOT NULL,              -- hex, f.eks. '#1E6FFF'
  tonn_bulk       REAL NOT NULL DEFAULT 0,
  antall_bigbags  INTEGER NOT NULL DEFAULT 0
);

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
  salttype     TEXT NOT NULL REFERENCES Varelager(salttype),
  tonn         REAL NOT NULL CHECK (tonn > 0),
  frist        TEXT NOT NULL,                 -- ISO 8601 UTC
  status       TEXT NOT NULL DEFAULT 'Ny'
               CHECK (status IN ('Ny', 'Planlagt', 'Under lasting', 'Ferdig')),
  batanlop_id  INTEGER REFERENCES Batanlop(id) ON DELETE SET NULL
);
CREATE INDEX idx_so_frist   ON Salgsordrer(frist);
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

-- Hva som faktisk ligger i en SO: bulk (tonn), bigbags eller pallevarer (sekker på pall).
-- Bigbag/Pall må klargjøres/plukkes; Bulk lastes direkte av hjullaster.
-- Totalvekt (kg) = antall * kg_per_enhet.
CREATE TABLE SalgsordreLinjer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  so_id         INTEGER NOT NULL REFERENCES Salgsordrer(id) ON DELETE CASCADE,
  produkt       TEXT NOT NULL,                -- f.eks. 'Fint raffinert salt'
  salttype      TEXT NOT NULL REFERENCES Varelager(salttype),  -- gir fargekode
  emballasje    TEXT NOT NULL CHECK (emballasje IN ('Bulk', 'Bigbag', 'Pall')),
  antall        REAL NOT NULL CHECK (antall > 0),  -- tonn (Bulk), stk bigbag, eller antall paller
  enhet         TEXT NOT NULL,                -- visningstekst: 'tonn', '1000 kg', '40 × 25 kg'
  kg_per_enhet  REAL NOT NULL                 -- Bulk: 1000 (pr. tonn), Bigbag: 1000/500, Pall: 40×25=1000
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
