-- Rieber Flow – Cloudflare D1 schema
-- Kjøres på nytt ved reset (DROP først), så seed er idempotent.


DROP TABLE IF EXISTS BatLasteplan;
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
