-- Startdata: bare én standardbruker. Alt annet (produkter, båtanløp, ordrer, kaibok, fravær) legges inn i appen.
-- Med Cloudflare Access opprettes brukerne automatisk ved innlogging.
INSERT INTO Brukere (epost, navn, rolle) VALUES ('formann@rieber.demo', 'Terminalformann', 'Formann');

INSERT INTO Oppsett (nokkel, verdi) VALUES ('demo-fjernet', '1');
