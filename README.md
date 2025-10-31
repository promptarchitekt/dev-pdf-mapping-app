PDF‑Mapping‑App

Kurzbeschreibung
- Web‑App zum Platzieren von Datenfeldern auf PDF‑Vorlagen (Mapping JSON) mit Klick & Drag.
- Stack: Next.js 16, React 18, Tailwind. pdf.js Worker lokal gebundelt (keine CDN‑Abhängigkeit).

Funktionen
- PDF und Mapping (JSON) laden
- Feldnavigation (Liste, Weiter/Zurück), Live‑Koordinaten
- Platzierung per Klick; `boolean_pair` mit zwei Klicks (True/Ja, dann False/Nein)
- Marker verschieben per Drag; Statusanzeige (platziert/offen)
- „Mapping speichern“ → lädt aktualisierte JSON herunter

Schnellstart (lokal)
1) In den Ordner wechseln:
   cd PDF-Mapping-App
2) Abhängigkeiten installieren (kopiert pdf.js‑Worker nach `public/`):
   npm install
3) Dev‑Server starten (Port automatisch):
   npm run dev
   Alternative: Windows‑Starter `start-dev.cmd` oder PowerShell `start-dev.ps1`

Bereitstellung auf Vercel
- Importiere dieses Repository als Next.js‑Projekt.
- Build Command: `npm run build` (Standard). Output: automatisch `.next`.
- Node: >= 20.9 (in `package.json` als `engines` hinterlegt).
- Der pdf.js‑Worker wird über `postinstall` nach `public/pdf.worker.min.mjs` kopiert und über `GlobalWorkerOptions.workerSrc` genutzt.

Warum keine Inhalte?
- Dieses Repo enthält nur die App (keine amtlichen PDFs, Mappings oder XML‑Daten). So bleibt das Projekt sauber und öffentlich bereitstellbar.

Hinweise
- Das Tool erzeugt keine PDFs; das Stempeln passiert serverseitig/CLI (z. B. Python `stamp_pdf.py`).
- Feld `ID_USER` wird bei der Platzierung ignoriert.

Lizenz
- Proprietär / intern – bitte projektintern abstimmen.
