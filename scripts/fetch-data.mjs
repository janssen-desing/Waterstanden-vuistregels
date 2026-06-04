#!/usr/bin/env node
// scripts/fetch-data.mjs
//
// Haalt waterstanden op en schrijft data.json.
// Twee bronnen:
//   1. PEGELONLINE (WSV-DE)  -> Duitse + Zwitserse Rijnpegels  (simpele GET-JSON)
//   2. RWS WaterWebservices  -> Nederlandse pegels (Lek, Maas, Waal) (POST-JSON, ddapi20)
//
// PEGELONLINE blijft self-healing: bij 404 zoekt het script de juiste slug op.

import { writeFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// 1. PEGELONLINE-stations (Duitsland + Zwitserland)
// ---------------------------------------------------------------------------
const PEG_STATIONS = [
  { key: "basel",            naam: "Basel",      land: "🇨🇭", slug: "Basel-Rheinhalle" },
  { key: "maxau",            naam: "Maxau",      land: "🇩🇪", slug: "maxau" },
  { key: "oestrich",         naam: "Oestrich",   land: "🇩🇪", slug: "oestrich" },
  { key: "kaub",             naam: "Kaub",       land: "🇩🇪", slug: "kaub" },
  { key: "koblenz",          naam: "Koblenz",    land: "🇩🇪", slug: "koblenz" },
  { key: "koeln",            naam: "Keulen",     land: "🇩🇪", slug: "KÖLN" },
  { key: "duesseldorf",      naam: "Düsseldorf", land: "🇩🇪", slug: "DÜSSELDORF" },
  { key: "duisburg-ruhrort", naam: "Duisburg",   land: "🇩🇪", slug: "duisburg-ruhrort" },
  { key: "wesel",            naam: "Wesel",      land: "🇩🇪", slug: "wesel" },
];

const PEG_BASE = "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations";
const ALL_STATIONS_URL = `${PEG_BASE}.json?waters=RHEIN`;
const UA = "rijn-waterstanden-bot/1.0 (https://github.com)";

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let allStationsCache = null;
async function getAllRhineStations() {
  if (allStationsCache !== null) return allStationsCache;
  try { allStationsCache = await fetchJson(ALL_STATIONS_URL); }
  catch (e) { console.warn("Kon stationslijst niet ophalen:", e.message); allStationsCache = []; }
  return allStationsCache;
}

async function discoverSlug(intended) {
  const all = await getAllRhineStations();
  if (!all.length) return null;
  const lc = intended.toLowerCase();
  const norm = (s) => (s || "").toLowerCase().replace(/[-_\s]/g, "");
  let m = all.find(s => (s.shortname || "").toLowerCase() === lc);
  if (m) return { slug: m.shortname, hoe: "exact" };
  m = all.find(s => norm(s.shortname) === norm(intended));
  if (m) return { slug: m.shortname, hoe: "genormaliseerd" };
  m = all.find(s => (s.shortname || "").toLowerCase().startsWith(lc));
  if (m) return { slug: m.shortname, hoe: "prefix" };
  m = all.find(s => (s.shortname || "").toLowerCase().includes(lc));
  if (m) return { slug: m.shortname, hoe: "substring" };
  m = all.find(s => (s.longname || "").toLowerCase().includes(lc));
  if (m) return { slug: m.shortname, hoe: "longname" };
  return null;
}

async function tryFetchSlug(slug) {
  const cur  = await fetchJson(`${PEG_BASE}/${encodeURIComponent(slug)}/W/currentmeasurement.json`);
  const hist = await fetchJson(`${PEG_BASE}/${encodeURIComponent(slug)}/W/measurements.json?start=P2D`).catch(() => []);
  return {
    slug,
    pegel: cur.value,
    timestamp: cur.timestamp,
    trend: cur.trend ?? 0,
    history: (hist || []).map(h => ({ t: h.timestamp, v: h.value })),
  };
}

async function fetchPegStation(station) {
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
        return { ...station, ...data, error: null, slugFixed: `${station.slug} → ${found.slug} (${found.hoe})` };
      } catch (e2) { console.warn(`[${station.key}] ook '${found.slug}' faalde: ${e2.message}`); }
    }
    return { ...station, pegel: null, timestamp: null, trend: 0, history: [], error: e1.message };
  }
}

// ---------------------------------------------------------------------------
// 2. RWS-stations (Nederland) via ddapi20 WaterWebservices
// ---------------------------------------------------------------------------
const RWS_STATIONS = [
  // Lek / Nederrijn (stuwpanden, benedenstrooms peil)
  { key: "hagestein", naam: "Hagestein beneden", land: "🇳🇱", code: "hagestein.beneden" },
  { key: "amerongen", naam: "Amerongen beneden", land: "🇳🇱", code: "amerongen.beneden" },
  { key: "driel",     naam: "Driel beneden",     land: "🇳🇱", code: "driel.beneden" },
  { key: "ijsselkop", naam: "IJsselkop",         land: "🇳🇱", code: "westervoort.ijsselkop" },
  // Maas
  { key: "lith",      naam: "Lith dorp",         land: "🇳🇱", code: "lith.beneden" },
  // Waal
  { key: "nijmegen",  naam: "Nijmegen",          land: "🇳🇱", code: "nijmegen.waal" },
  { key: "tiel",      naam: "Tiel",              land: "🇳🇱", code: "tiel.waal" },
];

const RWS_OW = "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";

function isoOffset(d) {
  const p = (n) => String(n).padStart(2, "0");
  const tz = -d.getTimezoneOffset();
  const s = tz >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000${s}${p(Math.abs(tz)/60|0)}:${p(Math.abs(tz)%60)}`;
}

async function fetchRwsStation(station) {
  const now = new Date();
  const begin = new Date(now.getTime() - 6 * 3600 * 1000); // laatste 6 uur
  const body = {
    Locatie: { Code: station.code },
    AquoPlusWaarnemingMetadata: {
      AquoMetadata: { Compartiment: { Code: "OW" }, Grootheid: { Code: "WATHTE" }, ProcesType: "meting" },
      WaarnemingMetadata: { OpdrachtgevendeInstantieLijst: ["RIKZMON_WAT"] },
    },
    Periode: { Begindatumtijd: isoOffset(begin), Einddatumtijd: isoOffset(now) },
  };
  try {
    let r = await fetch(RWS_OW, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": "rijn-waterstanden" },
      body: JSON.stringify(body),
    });
    // 204 = geen data met deze instantie-filter; probeer zonder instantie-filter
    if (r.status === 204) {
      delete body.AquoPlusWaarnemingMetadata.WaarnemingMetadata;
      r = await fetch(RWS_OW, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": "rijn-waterstanden" },
        body: JSON.stringify(body),
      });
    }
    if (r.status === 204) throw new Error("geen recente meting (204)");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();

    // Verzamel alle metingen, neem de meest recente plausibele waarde, bouw history op.
    const points = [];
    for (const w of (j.WaarnemingenLijst || [])) {
      for (const m of (w.MetingenLijst || [])) {
        const v = m.Meetwaarde?.Waarde_Numeriek;
        const q = m.WaarnemingMetadata?.Kwaliteitswaardecode
               ?? m.WaarnemingMetadata?.KwaliteitswaardecodeLijst?.[0];
        if (v == null || Math.abs(v) >= 99999) continue;          // hiaat (99) / onzin
        if (q === "99") continue;
        points.push({ t: m.Tijdstip, v });
      }
    }
    if (!points.length) throw new Error("geen plausibele waarde");
    points.sort((a, b) => (a.t < b.t ? -1 : 1));
    const last = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const trend = prev ? Math.sign(last.v - prev.v) : 0;

    return {
      key: station.key, naam: station.naam, land: station.land, code: station.code,
      pegel: last.v, timestamp: last.t, trend,
      history: points.slice(-200),
      error: null,
    };
  } catch (e) {
    return {
      key: station.key, naam: station.naam, land: station.land, code: station.code,
      pegel: null, timestamp: null, trend: 0, history: [], error: e.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== Rijn + NL waterstanden fetch ===");
  const t0 = Date.now();

  const results = await Promise.all([
    ...PEG_STATIONS.map(fetchPegStation),
    ...RWS_STATIONS.map(fetchRwsStation),
  ]);

  const ok     = results.filter(r => !r.error);
  const fail   = results.filter(r =>  r.error);
  const healed = results.filter(r =>  r.slugFixed);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nKlaar in ${dt}s · ${ok.length}/${results.length} OK · ${fail.length} fout · ${healed.length} hersteld`);
  for (const r of results) {
    const v = r.pegel != null ? String(Math.round(r.pegel)).padStart(5) : "  err";
    console.log(`  ${String(r.key).padEnd(18)} ${v} cm  ${r.error ? "✗ "+r.error : ""}`);
  }

  const output = {
    stations: results,
    updated: new Date().toISOString(),
    okCount: ok.length,
    errorCount: fail.length,
    healedCount: healed.length,
  };

  await writeFile("data.json", JSON.stringify(output, null, 2));
  console.log("\n→ data.json geschreven");

  if (ok.length === 0) { console.error("Alle stations gefaald — exit 1"); process.exit(1); }
}

main().catch(e => { console.error("Fataal:", e); process.exit(1); });
