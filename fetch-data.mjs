#!/usr/bin/env node
// scripts/fetch-data.mjs
//
// Haalt waterstanden op van PEGELONLINE + wasserkarte.net en schrijft data.json.
// Self-healing: bij een 404 op een slug probeert dit script automatisch
// de juiste slug te ontdekken via de PEGELONLINE-stationslijst.

import { writeFile } from "node:fs/promises";

const STATIONS = [
  { key: "maxau",            naam: "Maxau",      land: "🇩🇪", slug: "maxau" },
  { key: "oestrich",         naam: "Oestrich",   land: "🇩🇪", slug: "oestrich" },
  { key: "kaub",             naam: "Kaub",       land: "🇩🇪", slug: "kaub" },
  { key: "koblenz",          naam: "Koblenz",    land: "🇩🇪", slug: "koblenz" },
  { key: "koeln",            naam: "Köln",       land: "🇩🇪", slug: "koeln" },
  { key: "duesseldorf",      naam: "Düsseldorf", land: "🇩🇪", slug: "duesseldorf" },
  { key: "duisburg-ruhrort", naam: "Duisburg",   land: "🇩🇪", slug: "duisburg-ruhrort" },
  { key: "wesel",            naam: "Wesel",      land: "🇩🇪", slug: "wesel" },
];

const PEG_BASE = "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations";
const ALL_STATIONS_URL = `${PEG_BASE}.json?waters=RHEIN`;
const WASSERKARTE_URL = "https://wasserkarte.net/gids/waterstand.php?plaats=Nijmegen-haven";
const UA = "rijn-waterstanden-bot/1.0 (https://github.com)";

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchText(url) {
  const r = await fetch(url, { headers: {
    "User-Agent": "Mozilla/5.0 (compatible; rijn-waterstanden-bot/1.0)",
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
  }});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

let allStationsCache = null;
async function getAllRhineStations() {
  if (allStationsCache !== null) return allStationsCache;
  try {
    allStationsCache = await fetchJson(ALL_STATIONS_URL);
  } catch (e) {
    console.warn("Kon stationslijst niet ophalen:", e.message);
    allStationsCache = [];
  }
  return allStationsCache;
}

// Self-heal: probeer de juiste slug te vinden in de stationslijst
async function discoverSlug(intended) {
  const all = await getAllRhineStations();
  if (!all.length) return null;
  const lc = intended.toLowerCase();
  const norm = (s) => (s || "").toLowerCase().replace(/[-_\s]/g, "");

  // 1. Exacte match op shortname (case-insensitive)
  let m = all.find(s => (s.shortname || "").toLowerCase() === lc);
  if (m) return { slug: m.shortname, hoe: "exact" };

  // 2. Genormaliseerde match (zonder streepjes/spaties)
  m = all.find(s => norm(s.shortname) === norm(intended));
  if (m) return { slug: m.shortname, hoe: "genormaliseerd" };

  // 3. Begint met
  m = all.find(s => (s.shortname || "").toLowerCase().startsWith(lc));
  if (m) return { slug: m.shortname, hoe: "prefix" };

  // 4. Bevat
  m = all.find(s => (s.shortname || "").toLowerCase().includes(lc));
  if (m) return { slug: m.shortname, hoe: "substring" };

  // 5. Match op longname
  m = all.find(s => (s.longname || "").toLowerCase().includes(lc));
  if (m) return { slug: m.shortname, hoe: "longname" };

  return null;
}

async function tryFetchSlug(slug) {
  const cur  = await fetchJson(`${PEG_BASE}/${slug}/W/currentmeasurement.json`);
  const hist = await fetchJson(`${PEG_BASE}/${slug}/W/measurements.json?start=P2D`).catch(() => []);
  return {
    slug,
    pegel: cur.value,
    timestamp: cur.timestamp,
    trend: cur.trend ?? 0,
    history: (hist || []).map(h => ({ t: h.timestamp, v: h.value })),
  };
}

async function fetchOneStation(station) {
  try {
    const data = await tryFetchSlug(station.slug);
    return { ...station, ...data, error: null };
  } catch (e1) {
    console.warn(`[${station.key}] '${station.slug}' faalde (${e1.message}). Slug-discovery...`);
    const found = await discoverSlug(station.key);
    if (found && found.slug !== station.slug) {
      try {
        const data = await tryFetchSlug(found.slug);
        console.log(`[${station.key}] ✓ hersteld via ${found.hoe}: '${station.slug}' → '${found.slug}'`);
        return {
          ...station, ...data, error: null,
          slugFixed: `${station.slug} → ${found.slug} (${found.hoe})`,
        };
      } catch (e2) {
        console.warn(`[${station.key}] ook '${found.slug}' faalde: ${e2.message}`);
      }
    }
    return {
      ...station, pegel: null, timestamp: null, trend: 0, history: [],
      error: e1.message,
    };
  }
}

async function fetchNijmegen() {
  const station = { key: "nijmegen", naam: "Nijmegen", land: "🇳🇱", waal: true, slug: null };
  // Meerdere regex-patronen — als de site z'n opmaak verandert blijft er meestal eentje werken
  const PATTERNS = [
    /NAP[^\d-]{0,40}(-?\d+)\s*cm/i,
    /Nijmegen[^\d-]{0,200}?(-?\d+)\s*cm/i,
    /waterstand[^\d-]{0,100}?(-?\d+)\s*cm/i,
    /(-?\d+)\s*cm\s*\(?\s*NAP/i,
  ];
  try {
    const html = await fetchText(WASSERKARTE_URL);
    for (const [i, pat] of PATTERNS.entries()) {
      const m = html.match(pat);
      if (m) {
        const n = parseInt(m[1]);
        if (Math.abs(n) < 3000) { // sanity check op plausibele cm-waarde
          return {
            ...station, pegel: n, timestamp: new Date().toISOString(),
            trend: 0, history: [], error: null,
            patternUsed: i,
          };
        }
      }
    }
    throw new Error("geen plausibele waarde in HTML gevonden");
  } catch (e) {
    return { ...station, pegel: null, timestamp: null, trend: 0, history: [], error: e.message };
  }
}

async function main() {
  console.log("=== Rijn waterstanden fetch ===");
  const t0 = Date.now();

  const results = await Promise.all([
    ...STATIONS.map(s => fetchOneStation(s)),
    fetchNijmegen(),
  ]);

  const ok     = results.filter(r => !r.error);
  const fail   = results.filter(r =>  r.error);
  const healed = results.filter(r => r.slugFixed);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nKlaar in ${dt}s · ${ok.length}/${results.length} OK · ${fail.length} fout · ${healed.length} hersteld`);
  if (fail.length)   { console.log("\nFouten:");      fail.forEach(e => console.log(`  ${e.key}: ${e.error}`)); }
  if (healed.length) { console.log("\nHersteld:");    healed.forEach(h => console.log(`  ${h.key}: ${h.slugFixed}`)); }

  const output = {
    stations: results,
    updated: new Date().toISOString(),
    okCount: ok.length,
    errorCount: fail.length,
    healedCount: healed.length,
  };

  await writeFile("data.json", JSON.stringify(output, null, 2));
  console.log("\n→ data.json geschreven");

  // Faal alleen als élke station faalde (anders heeft de Action een
  // succesvolle deploy en wordt de oude data.json niet onnodig overschreven)
  if (ok.length === 0) {
    console.error("Alle stations gefaald — exit 1");
    process.exit(1);
  }
}

main().catch(e => {
  console.error("Fataal:", e);
  process.exit(1);
});
