# 🎮 SchoolArena.io - Multiplayer .io Game mit KI-Bots

SchoolArena.io ist ein produktionsreifes Multiplayer-Actionspiel, das speziell für Schulumgebungen entwickelt wurde. Es bietet eine lebendige Spielwelt durch permanent aktive, selbstlernende KI-Bots, die durch Reinforcement Learning (maschinelles Lernen) stetig besser werden.

## 🚀 Besonderheiten

- **Selbstlernende Bots:** 8-12 Bots trainieren 24/7 gegeneinander und entwickeln eigene Strategien.
- **Flüssiges Gameplay:** Client-Side Prediction und Interpolation für ein ruckelfreies Erlebnis.
- **Anti-Cheat System:** Serverseitige Validierung von Geschwindigkeit, Schussrate und Position.
- **Power-Ups:** Schild, Schaden-Boost und Geschwindigkeits-Boost für taktische Tiefe.
- **Persistenz:** Bots speichern ihren Fortschritt; Spieler behalten ihre Statistiken über Browser-Sessions hinweg.

---

## 🛠️ Installation & Start

### Lokal ausführen
1. **Node.js installieren:** Stelle sicher, dass Node.js (Version >= 16) installiert ist.
2. **Repository klonen:** Lade den Code herunter.
3. **Abhängigkeiten installieren:**
   ```bash
   npm install
   ```
4. **Server starten:**
   ```bash
   npm start
   ```
5. **Spielen:** Öffne `http://localhost:3000` in deinem Browser.

### Cloud-Deployment (z.B. Replit oder Glitch)
- Einfach den Code hochladen und `npm start` als Start-Befehl festlegen. Der Server nutzt automatisch den zugewiesenen Port.

---

## ⌨️ Steuerung

| Aktion | Eingabe |
| :--- | :--- |
| **Bewegung** | Maus bewegen |
| **Schießen** | Linksklick |
| **Boost** | Leertaste halten (kostet Masse!) |
| **Chat** | ENTER drücken zum Schreiben / Senden |
| **Beobachten** | TAB (nach dem Tod zum Wechseln) |
| **Debug-Modus** | Taste 'D' togglen |

---

## 🤖 Das KI-Bot System

Die Bots in SchoolArena.io nutzen ein eigenes **Neuronales Netzwerk** (30 Inputs, 64/64 Hidden Neuronen, 6 Outputs).

### Bot-Persönlichkeiten
- **Hunter (Aggressiv):** Jagt bevorzugt andere Spieler, erhält mehr Belohnung für Kills.
- **Farmer (Vorsichtig):** Meidet Kämpfe und konzentriert sich auf das Sammeln von XP.
- **Tactician (Strategisch):** Balanciert zwischen Kampf und Sammeln, greift bei Vorteil an.
- **Wildcard (Chaotisch):** Unvorhersehbares Verhalten für mehr Abwechslung.

### Training-Pipeline
1. **Daten-Sammlung:** Bots speichern ihre Erfahrungen (Zustand, Aktion, Belohnung).
2. **Lernen:** Alle 30 Sekunden trainieren die Bots ihre Netzwerke (gestaffelt, um Lags zu vermeiden).
3. **Persistenz:** Der Fortschritt wird in `data/bots/` als JSON gespeichert und stündlich gesichert.

---

## 🛡️ Anti-Cheat & Sicherheit

- **Geschwindigkeits-Check:** Spieler, die sich schneller als physikalisch möglich bewegen, werden zurückgesetzt und nach mehrfachen Verstößen gekickt.
- **Rate-Limiting:** Übermäßiger Spam von Netzwerk-Events führt zu einer automatischen 5-Minuten-Sperre der IP.
- **XSS-Schutz:** Chat-Nachrichten und Namen werden bereinigt, um schädlichen Code zu verhindern.

---

## 📊 Spielmechanik

- **XP & Level:**
  - Sammle Futter (+5 bis +20 XP).
  - Treffe Gegner (+15 XP).
  - Eliminiere Gegner (+100 XP + Bonus).
  - Höhere Level machen dich größer und stärker, aber auch langsamer.
- **Kill-Streaks:** Erreiche 3 oder mehr Kills ohne Tod, um "ON FIRE" zu sein (visueller Effekt).
- **Power-Ups:** Erscheinen selten (1% Chance) als goldene, blinkende Partikel.

---

## 📁 Dateistruktur

```
schoolarena-io/
├── server.js              # Hauptserver & Spiel-Logik
├── package.json           # Abhängigkeiten
├── public/                # Frontend-Dateien
│   ├── index.html         # UI & Struktur
│   ├── style.css          # Design
│   └── game.js            # Client-Logik & Rendering
└── data/                  # Persistente Daten (wird automatisch erstellt)
    ├── bots/              # Gespeicherte KI-Gehirne
    ├── backups/           # Stündliche Sicherheitskopien
    └── logs/              # Server- & Anti-Cheat-Logs
```

---

## 🛠️ Debug-Befehle (Konsole)

Für Entwickler stehen in der Browser-Konsole folgende Befehle zur Verfügung:
- `window.DEBUG_GOD_MODE = true` - Unverwundbarkeit (lokal).
- `window.DEBUG_SPEED_BOOST = 5.0` - Erhöht die Geschwindigkeit.
- `window.DEBUG_TELEPORT(x, y)` - Teleport zu Koordinaten.

---

## 📜 Lizenz

Dieses Projekt ist unter der MIT-Lizenz veröffentlicht und darf frei verwendet und angepasst werden.

Entwickelt für Schulen - für mehr Spaß in den Pausen! 🚀
