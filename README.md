# Gzowo Builders

Sandbox budowania pojazdów i maszyn z prawdziwą fizyką. Tylko tryb Kreatywny —
zero Survivalu, wrogów i craftingu, na zawsze. Bardzo inspirowany *Scrap
Mechanic*, ale z własną nazwą, własnym artem i bez kopiowania oryginału.

## Uruchomienie

Sam ze sobą — wystarczy statyczny serwer bez cache:

```bash
npm run serve
```

Potem `http://localhost:8290`.

Razem — jeden komputer hostuje, reszta wchodzi przeglądarką:

```bash
npm install
npm start
```

Host wypisuje swój adres w sieci lokalnej. Pozostali otwierają ten adres albo
wpisują go w polu „Gra z innymi" na karcie wejściowej. Zero builda po stronie
klienta: three.js i Rapier lecą z CDN jako ES modules.

## Sterowanie

| | |
|---|---|
| `WSAD` / `SPACJA` / `SHIFT` | ruch, skok, bieg |
| `LPM` | użyj tego, co trzymasz |
| `PPM` | usuń |
| `ŚPM` | pipeta |
| `TAB` | następny pasek narzędzi |
| `1`–`6`, `SCROLL` | slot na pasku |
| `R` / `SHIFT+R` | obrót w poziomie / na bok |
| `E` | wsiądź, wysiądź, przełącz |
| `V` | kamera FPP / TPP w pojeździe |
| `↑↓←→` | tłoki i obrotnice z fotela |
| `ESC` | menu (zapis, wczytanie, dźwięk, dołączanie) |

Paski narzędzi: **NARZĘDZIA** (usuwanie, malowanie, klonowanie, puść, kabel),
**BLOKI**, **MASZYNY**, **LOGIKA**, **GOTOWCE**.

## Stan

Wszystkie fazy 0–9 z master promptu zbudowane. Czeka na playtest, zwłaszcza
multiplayer na dwóch maszynach.

## Zapis świata

Menu na karcie wejściowej, trzy sloty. Sam ze sobą — pamięć przeglądarki.
W grze — dysk hosta (`server/saves/`), więc świat przeżywa to, że ktoś wyszedł.
Firebase RTDB włącza się sam, jeśli położysz `assets/firebase.json` z konfiguracją
aplikacji webowej; celowo nie ma go w repo, bo publiczna konfiguracja to zaproszenie
do cudzej bazy.

## Architektura

```
src/shared/    czysta logika — importowana bez zmian przez klienta i serwer
  grid.js        komórka 0.25 m, algebra orientacji, testy styku ścian
  parts.js       katalog 18 części, gęstość, wytrzymałość złączy, paleta
  blueprint.js   co zbudowane: rekordy, indeks komórek, graf styków, kable
  prefabs.js     gotowe maszyny do stemplowania
src/build/     construction.js (rdzeń: siatki, bryły, pękanie — działa headless),
               builder.js (kursor), vehicle.js (koła raycastowe),
               mechanisms.js (złącza), logic.js (układy), toolbars.js
src/render/    construction-view.js (cała warstwa graficzna Construction),
               geometry.js, materials.js, models.js
src/net/       protocol.js, session.js (kto zmienia świat), client.js, save.js
src/world/     terrain.js (pole wysokości), scatter.js (roślinność), meadow.js
src/physics/   świat Rapiera, stały krok 1/60, grupy kolizji
server/        server.js (host: statyki + WebSocket + autorytatywna fizyka)
tools/         parts.blend, addon Blender MCP, skrypt startowy
```

Konsola ma uchwyt `GB` — `GB.construction`, `GB.session`, `GB.net`, `GB.saves`.

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
