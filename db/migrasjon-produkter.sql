-- Migrasjon for eksisterende databaser (før produktkatalogen):
--  * fjerner demo-båtene fra Båtanløp (egne anløp beholdes)
--  * bygger om ordre-tabellene til å bruke Produkter (SKU) i stedet for salttyper, og fjerner demo-ordrer/-salttyper
-- CREATE-setningene hentes fra schema.sql (Produkter, Salgsordrer, SalgsordreLinjer, BatLasteplan + indekser).
DELETE FROM Batanlop WHERE skipsnavn IN ('MV Nordic Star', 'MS Baltic Trader', 'MV Arctic Breeze');
DROP TABLE IF EXISTS BatLasteplan;
DROP TABLE IF EXISTS SalgsordreLinjer;
DROP TABLE IF EXISTS Salgsordrer;
DROP TABLE IF EXISTS Varelager;
