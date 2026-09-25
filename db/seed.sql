-- Startdata: bare brukere, kaibok-historikk og fravær. Produkter (SKU-er), båtanløp og ordrer opprettes i appen.

-- Demo-brukere
INSERT INTO Brukere (epost, navn, rolle) VALUES
  ('formann@rieber.demo',  'Terminalformann', 'Formann'),
  ('kontor@rieber.demo',   'Kari Kontor',     'Kontor'),
  ('ledelse@rieber.demo',  'Leif Ledelse',    'Ledelse'),
  ('ola@rieber.demo',      'Ola Hjullaster',  'Sjåfør'),
  ('tone@rieber.demo',     'Tone Truck',      'Sjåfør'),
  ('per@rieber.demo',      'Per Plukk',       'Lager');

-- Kaibok (historikk)
INSERT INTO Kaibok (baatnavn, mmsi, kai_dato, operasjon, varetype, tonn, vurdering, tilbakemelding, opprettet) VALUES
  ('MV Nordic Star', NULL, date('now', '-152 days'), 'Lasting', 'Bulk', 5200, 'Bra', 'Lastet uten problemer. Ferdig 4 timer før planlagt avgang.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MS Baltic Trader', NULL, date('now', '-121 days'), 'Lossing', 'Pallevarer', 640, 'Merknad', '2 paller fikk fuktskade på plast – reklamert til rederiet. Resten OK.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Arctic Breeze', NULL, date('now', '-92 days'), 'Lasting', 'Begge', 3100, 'Bra', 'Bulk og bigbags lastet i riktig rekkefølge. Kaptein fornøyd.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Salt Carrier', NULL, date('now', '-63 days'), 'Lossing', 'Bulk', 7400, 'Bra', 'Lossing gikk raskt, ingen støvproblemer.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Nordic Star', NULL, date('now', '-77 days'), 'Lasting', 'Begge', 4100, 'Avvik', 'Hjullaster 2 stod med feil i 3 timer. Forsinket avgang. Bilder tatt av lasterommet.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MS Baltic Trader', NULL, date('now', '-46 days'), 'Lasting', 'Bulk', 2800, 'Bra', 'Uten merknader.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MS Kystlinje', NULL, date('now', '-31 days'), 'Lasting', 'Pallevarer', 380, 'Merknad', 'Manglet ett pallenummer på pakkseddel – rettet før avgang.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Salt Carrier', NULL, date('now', '-12 days'), 'Lasting', 'Bulk', 6100, 'Bra', 'Fin flyt. Vindkast under lasting, men ingen problemer.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('MV Nordic Star', NULL, date('now', '-19 days'), 'Lossing', 'Pallevarer', 520, 'Bra', 'Nitrittsalt og fint raffinert salt mottatt komplett.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Fravær i kalenderen
INSERT INTO Fravaer (bruker_id, kategori, tittel, dato_fra, dato_til, tid_fra, tid_til, ikke_overtid, opprettet) VALUES
  ((SELECT id FROM Brukere WHERE epost = 'kontor@rieber.demo'), 'Lege/tannlege', 'Tannlege', date('now', '+1 days'), date('now', '+1 days'), '09:00', '12:00', 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'ola@rieber.demo'), 'Verksted/bil', 'Leverer bilen på verksted', date('now', '+2 days'), date('now', '+2 days'), '07:00', '11:00', 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'tone@rieber.demo'), 'Skole/barn', 'Planleggingsdag på skolen', date('now', '+5 days'), date('now', '+5 days'), NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'ledelse@rieber.demo'), 'Ferie', 'Ferie', date('now', '+10 days'), date('now', '+14 days'), NULL, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'formann@rieber.demo'), 'Ikke overtid', 'Barnebursdag', date('now', '+3 days'), date('now', '+3 days'), NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'per@rieber.demo'), 'Sykdom', 'Barn syk', date('now', '+1 days'), date('now', '+1 days'), NULL, NULL, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ((SELECT id FROM Brukere WHERE epost = 'ola@rieber.demo'), 'Ikke overtid', 'Kan ikke ta overtid', date('now', '+4 days'), date('now', '+4 days'), NULL, NULL, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

