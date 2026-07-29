# Gzowo Builders

Sandbox budowania pojazdów i maszyn z prawdziwą fizyką. Tylko tryb Kreatywny —
zero Survivalu, wrogów i craftingu, na zawsze. Bardzo inspirowany *Scrap
Mechanic*, ale z własną nazwą, własnym artem i bez kopiowania oryginału.

## Uruchomienie

```bash
npm run serve
```

Potem `http://localhost:8290`. Zero builda — three.js i Rapier lecą z CDN jako ES
modules. Serwer multiplayer (`npm start`) dochodzi w fazie 7.

## Sterowanie

| | |
|---|---|
| `WSAD` | ruch |
| `SPACJA` / `SHIFT` | skok / bieg |
| `LPM` / `PPM` / `ŚPM` | postaw / usuń / pipeta |
| `R` / `SHIFT+R` | obrót w poziomie / położenie na bok |
| `1`–`6`, `SCROLL` | wybór części |
| `C` | tryb malowania (wtedy `SCROLL` zmienia kolor) |
| `ESC` | pauza |

## Stan

- **Faza 1 — gotowa.** Chodzenie FPP, siatka 0.25 m, snapping, sześć części
  strukturalnych, malowanie, płaska łąka z rampami testowymi. Wszystko, co
  postawisz, ma kolider — można po tym chodzić.
- Faza 2 — fizyka: bryły dynamiczne, złącza, integralność strukturalna.
- Faza 3 — pojazdy: koła, zawieszenie, silniki, siedzenie.
- Fazy 4–9 — mechanizmy, logika, pełna łąka, multiplayer, zapis, dopieszczanie.

## Architektura

```
src/shared/    czysta logika — importowana bez zmian przez klienta i (od fazy 7) serwer
  grid.js        komórka 0.25 m, algebra orientacji (16 obrotów), testy styku ścian
  parts.js       katalog części, gęstość, paleta
  blueprint.js   co jest zbudowane: rekordy, indeks komórek, graf styków, komponenty
src/physics/   świat Rapiera, stały krok 1/60, grupy kolizji
src/build/     construction.js (blueprint ↔ mesh ↔ kolider), builder.js (kursor)
src/render/    proceduralna geometria części, materiały palety
src/player/    kinematyczny kontroler postaci FPP
src/world/     łąka
src/ui/        hotbar, paleta, linia stanu
tools/         addon Blender MCP + skrypt startowy
assets/models/ .glb z Blendera (dochodzą stopniowo, kolidery zostają prymitywne)
```

Konsola ma uchwyt `GB` — `GB.construction`, `GB.player`, `GB.builder`, `GB.world`.

## Modele 3D

Wszystkie modele robi Blender przez MCP. Addon jest już zainstalowany w
Blenderze; żeby Claude mógł modelować, odpal:

```bash
./tools/blender-mcp-start.sh
```

Blender wstaje z serwerem MCP na porcie 9876. Konfiguracja klienta siedzi w
`../.mcp.json` (serwer `blender`) — Claude Code podłącza się przy starcie sesji.

Geometria w `src/render/geometry.js` jest tymczasowa i wymieniana jeden do
jednego na `.glb`. Kolidery **nie** zmieniają się przy tej wymianie — zostają
prymitywne (cuboid / convex hull), żeby symulacja była tania i deterministyczna
po obu stronach sieci.
