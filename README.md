# Rijn Waterstanden — GitHub Pages

Live waterstanden langs de Rijn als PWA op je iPhone. Volledig gratis: geen server, geen account-kosten, geen domain.

## Hoe het in elkaar zit

```
.
├── index.html                       ← de app (UI)
├── manifest.json                    ← PWA-config (iOS home screen)
├── data.json                        ← live data — wordt automatisch bijgewerkt
├── scripts/
│   └── fetch-data.mjs               ← haalt data op, met auto-herstel
└── .github/workflows/
    └── update-data.yml              ← draait elke 30 min, vult data.json
```

**Het idee:** GitHub Pages serveert alleen statische bestanden, dus kan zelf geen API's aanroepen (CORS-grens). Oplossing: een GitHub Action draait elke 30 min, roept zelf de API's aan en commit het resultaat als `data.json` naar de repo. Je site leest gewoon dat statische bestand — geen CORS, geen server, gratis.

**Self-healing:** als een station een 404 geeft (bijv. omdat PEGELONLINE de naam heeft veranderd), zoekt het script automatisch de juiste naam op in de volledige stationslijst en gebruikt die. Je krijgt een melding in de UI als dat gebeurt.

---

## Stappenplan — van niets naar live website

### Eenmalig op een laptop/desktop is veruit het makkelijkst. Iphone kan ook maar is fiddly. Hieronder de laptop-route.

### Stap 1 — GitHub-account

Ga naar **https://github.com** → tik op **Sign up**. Een gratis account is genoeg voor alles wat we doen.

### Stap 2 — Nieuwe repository aanmaken

1. Rechtsboven op **+** → **New repository**
2. **Repository name:** `rijn-waterstanden` (of iets anders, lowercase, geen spaties)
3. **Description:** *Live waterstanden langs de Rijn* (optioneel)
4. **Public** aanvinken (GitHub Pages is gratis voor public repo's)
5. **NIET** aanvinken: "Add a README file" / "Add .gitignore" / "Choose a license" — we uploaden zelf
6. Klik **Create repository**

### Stap 3 — Bestanden uploaden

Op de lege repo-pagina zie je een link **"uploading an existing file"**. Klik die.

1. Pak de ZIP uit die ik je gestuurd heb
2. **Sleep alle bestanden + mappen** uit de uitgepakte map naar het upload-veld
   - Belangrijk: de mapstructuur moet behouden blijven (`scripts/`, `.github/workflows/`)
   - Als je dropt vanuit Finder/Verkenner, gebeurt dat automatisch
3. Scroll naar beneden → **Commit changes**

Controleer dat je deze structuur ziet in de repo:
```
.github/workflows/update-data.yml
scripts/fetch-data.mjs
data.json
index.html
manifest.json
README.md
```

> **Als de mappen niet meekwamen** (kan op iPhone gebeuren): upload bestanden los, en gebruik de "Add file → Create new file" knop om paden als `scripts/fetch-data.mjs` te tikken — GitHub maakt dan automatisch de map aan. Niet leuk werk, dus liever een laptop voor deze stap.

### Stap 4 — GitHub Pages aanzetten

1. In je repo: tab **Settings** (helemaal rechts)
2. In het menu links: **Pages**
3. **Source:** *Deploy from a branch*
4. **Branch:** *main* — **Folder:** */ (root)*
5. Klik **Save**

Even later (30 sec - 1 min) zie je een groene melding bovenaan:
> *Your site is live at `https://<jouw-gebruikersnaam>.github.io/rijn-waterstanden/`*

Bewaar die URL.

### Stap 5 — Action-permissies aanzetten (kritiek!)

Dit is de stap die mensen vaak overslaan en dan werkt het auto-update niet:

1. In **Settings** (zelfde pagina als hiervoor)
2. Links menu: **Actions** → **General**
3. Scroll naar **"Workflow permissions"** onderaan
4. Kies **"Read and write permissions"**
5. *(Optioneel)* Vink ook *Allow GitHub Actions to create and approve pull requests* aan
6. Klik **Save**

Zonder deze stap kan de Action wel data ophalen, maar niet terug-pushen naar de repo, en blijft `data.json` leeg.

### Stap 6 — Eerste run handmatig starten

De cron-schedule wacht op de volgende halfheel uur. Om meteen iets te zien:

1. Tab **Actions** in je repo
2. Klik op de workflow **"Update waterstanden"** in de lijst links
3. *(Eerste keer)*: misschien zie je een gele banner — klik **"I understand my workflows, go ahead and enable them"**
4. Rechts klik je op **"Run workflow"** → groen knopje **Run workflow**
5. Wacht 30-60 seconden, klik op de run die verschijnt om de logs te zien
6. Bij succes zie je een nieuwe commit op de main-branch: "data: 2026-…"

### Stap 7 — Site openen op iPhone

1. Open **Safari** op je iPhone (moet Safari zijn, anders werkt PWA-install niet)
2. Ga naar je URL: `https://<jouw-gebruikersnaam>.github.io/rijn-waterstanden/`
3. Je ziet de waterstanden
4. Tik op de **Share-knop** (vierkant met pijl omhoog) onderaan
5. Scroll → **"Zet op beginscherm"** → **Voeg toe**

Klaar. Vanaf nu één tik op je home screen.

---

## Eerlijke verwachtingen

- **Updates komen elke 30 min** van de GitHub Action. De update-knop in de app haalt de meest recente versie op, maar als de Action net is gedraaid, krijg je dezelfde data.
- **Direct live nodig?** Tab Actions → Run workflow. Na ~45 sec is `data.json` ververst.
- **GitHub Actions vrij gebruik:** public repo = onbeperkt minuten, dus dit kost niets.
- **Scheduled workflows pauzeren** als de repo 60 dagen geen activiteit heeft. Eén commit of handmatige run wekt 'm weer.

---

## Bekend probleem: PEGELONLINE-slugs

Niet elke slug die ik heb opgegeven is mogelijk 100% correct. Mocht je in de app zien:
- ⚠ rode banner *"X stations konden niet worden opgehaald"*
- ✓ groene banner *"Auto-herstel actief op X stations"*

Bij de eerste: de slug is fout én de auto-discovery kon ook geen match vinden. Open in browser:
```
https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?waters=RHEIN
```

Zoek (Ctrl/Cmd+F) de naam van het station, kopieer de exacte `shortname` waarde, pas die aan in `scripts/fetch-data.mjs` (de `STATIONS`-array), commit en push.

Bij de tweede (auto-herstel): het script heeft de juiste slug zelf gevonden — alles werkt. De banner is alleen een hint om de slug ook in de code bij te werken, voor properheid.

---

## Vuistregels aanpassen

Tik op het "+80" / "−180" badge-cijfer op een kaart → sheet komt omhoog → pas aan → Bewaar. Of "Terug naar standaard" voor de waarde uit je Excel.

Wordt opgeslagen in `localStorage` van je browser. Apparaat-specifiek. Wis je browser-data = vuistregels weg.

---

## Wat is er níet ingebouwd

- **Voorspelling** voor de komende dagen — komt apart uit elwis.de Pegelvorhersage. Toe te voegen.
- **Basel** — zit niet in PEGELONLINE (Zwitsers). Aparte bron nodig.
- **Custom domein** — kan, via Settings → Pages → Custom domain. Vereist een domeinnaam.
- **Push-meldingen** bij drempel-overschrijding — niet gratis op GH Pages, vereist een aparte service.

---

## Troubleshooting

**"Nog niet bijgewerkt" en kaarten zijn leeg**
→ Stap 5 (Action permissies) overgeslagen, of stap 6 niet gedraaid. Check **Actions → Update waterstanden** of er een succesvolle run staat. Geen run = handmatig starten. Wel run maar gefaald = klik 'm open voor logs.

**Stap 6 faalde met "permission denied" of "exit 128"**
→ Stap 5: Workflow permissions op "Read and write", opnieuw runnen.

**Site geeft 404**
→ GitHub Pages neemt soms 1-2 minuten om live te gaan na de eerste setup. Wacht even. Check Settings → Pages of er staat "Your site is live".

**Auto-update werkt niet meer na 60 dagen**
→ Trigger 'm één keer handmatig in de Actions-tab. Cron-schedule loopt weer.

**De update-knop in de app draait blijvend**
→ De fetch faalt. Open de developer console (Share → "Web Inspector" via Mac, of test in laptop-browser) voor de echte fout.

---

## Updates terugzetten

Klaar met experimenteren en wil terug naar de originele code? Repository → klik op een bestand → tabblad **History** → kies een eerdere versie → kopieer-plak terug. Of in Git-termen: revert naar een eerdere commit.
