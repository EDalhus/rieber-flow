-- Mock-data for demo. Tidspunkter er relative til "nå" slik at demoen alltid ser fersk ut.

-- Demo-brukere
INSERT INTO Brukere (epost, navn, rolle) VALUES
  ('formann@rieber.demo',  'Terminalformann', 'Formann'),
  ('kontor@rieber.demo',   'Kari Kontor',     'Kontor'),
  ('ledelse@rieber.demo',  'Leif Ledelse',    'Ledelse'),
  ('ola@rieber.demo',      'Ola Hjullaster',  'Sjåfør'),
  ('tone@rieber.demo',     'Tone Truck',      'Sjåfør'),
  ('per@rieber.demo',      'Per Plukk',       'Lager');

-- 3 fargekodede salttyper
INSERT INTO Varelager (salttype, fargekode, tonn_bulk, antall_bigbags) VALUES
  ('Veisalt',   '#1E6FFF', 4820.0,  310),   -- Blått
  ('Landbruk',  '#16A34A', 1350.5,  540),   -- Grønt
  ('Industri',  '#F59E0B',  915.0,  128);   -- Oransje

-- 3 båter
INSERT INTO Batanlop (skipsnavn, mmsi, eta, status) VALUES
  ('MV Nordic Star',   '257123400', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 hours'),  'Lasting'),
  ('MS Baltic Trader', '219456700', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day', '+6 hours'), 'Ventet'),
  ('MV Arctic Breeze', '258987600', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+3 days'),   'Ventet');

-- 12 salgsordrer
-- Båt 1 (Nordic Star, 600t): 4 ordrer på tvers av kunder og salttyper
-- Båt 2 (Baltic Trader):     2 ordrer
-- Ledige ordrer (batanlop_id = NULL): 6 stk, vises i SO-køen og kan dras inn i en lasteplan
INSERT INTO Salgsordrer (ordrenummer, kunde, salttype, tonn, frist, status, batanlop_id) VALUES
  ('SO-10041', 'Statens vegvesen Region Nord', 'Veisalt',  200, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+6 hours'),  'Ferdig',        1),
  ('SO-10042', 'Felleskjøpet Agri',            'Landbruk', 150, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+6 hours'),  'Ferdig',        1),
  ('SO-10043', 'Nordland Veidrift AS',         'Veisalt',  150, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+6 hours'),  'Under lasting', 1),
  ('SO-10044', 'Kemira Industri',              'Industri', 100, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+6 hours'),  'Planlagt',      1),
  ('SO-10051', 'Baltic Salt Trading',          'Veisalt',  400, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+2 days'),   'Planlagt',      2),
  ('SO-10052', 'Agro Polska',                  'Landbruk', 250, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+2 days'),   'Planlagt',      2),
  ('SO-10061', 'Svalbard Næringsdrift',        'Industri', 300, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+4 days'),   'Ny',            NULL),
  ('SO-10071', 'Bodø Kommune',                 'Veisalt',   32, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+3 hours'),  'Ny',            NULL),
  ('SO-10072', 'Lofoten Landbruk SA',          'Landbruk',  28, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day'),    'Ny',            NULL),
  ('SO-10073', 'Fauske Entreprenør',           'Veisalt',   40, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+8 hours'),  'Ny',            NULL),
  ('SO-10074', 'Bakeri Nord AS',               'Industri',   5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+5 hours'),  'Ny',            NULL),
  ('SO-10075', 'Nordfisk Sløyeri',             'Industri', 2.5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+10 hours'), 'Ny',            NULL);

-- Lasteplan for Nordic Star: steg 1-2 ferdig (350 av 600t), steg 3 aktiv, steg 4 venter
INSERT INTO BatLasteplan (batanlop_id, so_id, rekkefolge_nummer, status, ferdig_tidspunkt) VALUES
  (1, 1, 1, 'Ferdig', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours')),
  (1, 2, 2, 'Ferdig', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hour')),
  (1, 3, 3, 'Aktiv',  NULL),
  (1, 4, 4, 'Venter', NULL);

-- Lasteplan for Baltic Trader: lagt, men ikke startet
INSERT INTO BatLasteplan (batanlop_id, so_id, rekkefolge_nummer, status) VALUES
  (2, 5, 1, 'Venter'),
  (2, 6, 2, 'Venter');

-- Innhold i hver SO (sum av linjer = SO.tonn)
INSERT INTO SalgsordreLinjer (so_id, produkt, salttype, emballasje, antall, enhet, kg_per_enhet) VALUES
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10041'), 'Veisalt', 'Veisalt', 'Bulk', 200, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10042'), 'Grovsalt landbruk', 'Landbruk', 'Bulk', 100, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10042'), 'Grovsalt landbruk', 'Landbruk', 'Bigbag', 50, '1000 kg', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10043'), 'Veisalt', 'Veisalt', 'Bulk', 150, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10044'), 'Industrisalt', 'Industri', 'Bulk', 100, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10051'), 'Veisalt', 'Veisalt', 'Bulk', 400, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10052'), 'Grovsalt landbruk', 'Landbruk', 'Bulk', 250, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10061'), 'Industrisalt', 'Industri', 'Bulk', 200, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10061'), 'Industrisalt', 'Industri', 'Bigbag', 100, '1000 kg', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10071'), 'Veisalt', 'Veisalt', 'Bulk', 32, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10072'), 'Grovsalt landbruk', 'Landbruk', 'Bigbag', 20, '1000 kg', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10072'), 'Fôrsalt', 'Landbruk', 'Pall', 8, '40 × 25 kg', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10073'), 'Veisalt', 'Veisalt', 'Bulk', 40, 'tonn', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10074'), 'Fint raffinert salt', 'Industri', 'Pall', 3, '40 × 25 kg', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10074'), 'Fint raffinert salt', 'Industri', 'Bigbag', 2, '1000 kg', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10075'), 'Nitrittsalt', 'Industri', 'Pall', 2, '40 × 25 kg', 1000),
  ((SELECT id FROM Salgsordrer WHERE ordrenummer = 'SO-10075'), 'Fint raffinert salt', 'Industri', 'Bigbag', 1, '500 kg', 500);

-- Flåte for demo-brukerne (plassholder-MMSI-er; i ekte AIS-modus legger man til ekte fartøy via søk)
INSERT INTO Flate (bruker_id, mmsi, navn, lagt_til)
SELECT b.id, f.mmsi, f.navn, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM Brukere b
JOIN (
  SELECT '257123400' AS mmsi, 'MV Nordic Star' AS navn
  UNION ALL SELECT '219456700', 'MS Baltic Trader'
  UNION ALL SELECT '258987600', 'MV Arctic Breeze'
  UNION ALL SELECT '257555100', 'MV Salt Carrier'
) f;

-- Kaibok (historikk)
INSERT INTO Kaibok (baatnavn, mmsi, kai_dato, operasjon, varetype, tonn, vurdering, tilbakemelding, opprettet) VALUES
  ('MV Nordic Star', '257123400', date('now', '-152 days'), 'Lasting', 'Bulk', 5200, 'Bra', 'Lastet uten problemer. Ferdig 4 timer før planlagt avgang.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MS Baltic Trader', '219456700', date('now', '-121 days'), 'Lossing', 'Pallevarer', 640, 'Merknad', '2 paller fikk fuktskade på plast – reklamert til rederiet. Resten OK.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Arctic Breeze', '258987600', date('now', '-92 days'), 'Lasting', 'Begge', 3100, 'Bra', 'Bulk og bigbags lastet i riktig rekkefølge. Kaptein fornøyd.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Salt Carrier', '257555100', date('now', '-63 days'), 'Lossing', 'Bulk', 7400, 'Bra', 'Lossing gikk raskt, ingen støvproblemer.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Nordic Star', '257123400', date('now', '-77 days'), 'Lasting', 'Begge', 4100, 'Avvik', 'Hjullaster 2 stod med feil i 3 timer. Forsinket avgang. Bilder tatt av lasterommet.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MS Baltic Trader', '219456700', date('now', '-46 days'), 'Lasting', 'Bulk', 2800, 'Bra', 'Uten merknader.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MS Kystlinje', NULL, date('now', '-31 days'), 'Lasting', 'Pallevarer', 380, 'Merknad', 'Manglet ett pallenummer på pakkseddel – rettet før avgang.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Salt Carrier', '257555100', date('now', '-12 days'), 'Lasting', 'Bulk', 6100, 'Bra', 'Fin flyt. Vindkast under lasting, men ingen problemer.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Nordic Star', '257123400', date('now', '-19 days'), 'Lossing', 'Pallevarer', 520, 'Bra', 'Nitrittsalt og fint raffinert salt mottatt komplett.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Fravær i kalenderen
INSERT INTO Fravaer (bruker_id, kategori, tittel, dato_fra, dato_til, tid_fra, tid_til, ikke_overtid, opprettet) VALUES
  ((SELECT id FROM Brukere WHERE epost = 'kontor@rieber.demo'), 'Lege/tannlege', 'Tannlege', date('now', '+1 days'), date('now', '+1 days'), '09:00', '12:00', 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'ola@rieber.demo'), 'Verksted/bil', 'Leverer bilen på verksted', date('now', '+2 days'), date('now', '+2 days'), '07:00', '11:00', 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'tone@rieber.demo'), 'Skole/barn', 'Planleggingsdag på skolen', date('now', '+5 days'), date('now', '+5 days'), NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'ledelse@rieber.demo'), 'Ferie', 'Ferie', date('now', '+10 days'), date('now', '+14 days'), NULL, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'formann@rieber.demo'), 'Ikke overtid', 'Barnebursdag', date('now', '+3 days'), date('now', '+3 days'), NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'per@rieber.demo'), 'Sykdom', 'Barn syk', date('now', '+1 days'), date('now', '+1 days'), NULL, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'ola@rieber.demo'), 'Ikke overtid', 'Kan ikke ta overtid', date('now', '+4 days'), date('now', '+4 days'), NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
