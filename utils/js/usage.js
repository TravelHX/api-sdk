/**
 * @api-sdk/js — USAGE BY EXAMPLE (and a self-verifying integration test).
 *
 * Read this top-to-bottom: ~20 examples ordered from trivial to advanced, each
 * a short, real snippet a consumer would write. Run it (`node usage.js`) and it
 * doubles as a test — every example asserts, and the process exits non-zero if
 * any check fails.
 *
 * DATA-AGNOSTIC: the checks never hardcode facts about the sample data (no
 * "95 voyages", no "ship SC", no "price 10423.82"). Instead they pick subjects
 * from whatever was loaded and assert INVARIANTS — relationships that must hold
 * for any valid dataset (e.g. "every departure is owned by exactly one voyage",
 * "offering.departure === its departure", "the cheapest is really the minimum").
 * Narration still prints the real values so it reads as a live example.
 *
 * The SDK is used exactly as an external consumer would: only the package root
 * and its interface (`createApiSdk` -> `IApiSdk`). No deep imports.
 */

import { createApiSdk } from '@api-sdk/js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/** @typedef {import('@api-sdk/js').IApiSdk} IApiSdk */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// A fixed "today" makes the upcoming-vs-past filtering deterministic; the
// invariant checked (every upcoming date >= today) holds for any value.
const TODAY = '2026-06-08';

// --- tiny harness -----------------------------------------------------------

let passed = 0;
let failed = 0;
function check(label, condition) {
    if (condition) {
        passed++;
        console.log(`     \x1b[32m✓\x1b[0m ${label}`);
    } else {
        failed++;
        console.log(`     \x1b[31m✗ ${label}\x1b[0m`);
    }
}
function example(n, title) {
    console.log(`\n\x1b[36m${String(n).padStart(2)} · ${title}\x1b[0m`);
}
function show(text) {
    console.log(`     \x1b[90m${text}\x1b[0m`);
}

// --- the per-currency rate files, discovered from the data folder -----------
// `sources` is just the object `sdk.load()` needs. Four entries are single file
// paths; `sourceMarkets` is a *list*, built by: list the folder (readdirSync) ->
// keep only the per-currency rate files (filter + regex) -> make each a full
// path (map).
const ref = path.join(ROOT, 'data', 'FlatFileSample', 'flatfiles_dev', 'flatfiles_dev', 'RefData');
const sources = {
    voyages: path.join(ref, 'voyages.json'),
    ships: path.join(ref, 'ships.json'),
    cabinGrades: path.join(ref, 'cabingrades.json'),
    ports: path.join(ref, 'portlist.json'),
    sourceMarkets: fs
        .readdirSync(ref) // every filename in RefData
        .filter((f) => /^SourceMarket_.*_seaware\.json$/.test(f)) // only the currency rate files
        .map((f) => path.join(ref, f)), // -> absolute paths
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
    // =======================================================================
    // OOP USAGE (1–8)
    // =======================================================================

    // 01 — Create the SDK. It's dormant: no file is read until load().
    example(1, 'Create the SDK (dormant)');
    /** @type {IApiSdk} */
    const sdk = createApiSdk();
    check('createApiSdk() returns something usable', !!sdk);
    check('nothing loaded yet (isLoaded === false)', sdk.isLoaded === false);

    // 02 — Load. The one async action that reads files & builds the graph.
    example(2, 'Load the data (the only async step)');
    await sdk.load(sources);
    check('isLoaded === true after load()', sdk.isLoaded === true);

    // Pick representative subjects FROM the loaded data, so nothing below is
    // pinned to a specific dataset. These are the only preconditions: the data
    // must contain at least one priced departure for the examples to mean anything.
    const sampleDeparture =
        sdk.departures.find((d) => d.ship && d.offerings.some((o) => o.prices.length > 0)) ??
        sdk.departures.find((d) => d.offerings.length > 0) ??
        sdk.departures[0];
    const sampleOffering =
        sampleDeparture?.offerings.find((o) => o.prices.length > 0) ??
        sdk.offerings.find((o) => o.prices.length > 0);
    const sampleCurrency = sampleOffering?.prices[0]?.currency;
    const sampleShip = sampleDeparture?.ship ?? sdk.ships.find((s) => s.departures.length > 0);
    const sampleGrade = sampleOffering?.cabinGrade ?? sdk.cabinGrades.find((g) => g.offerings.length > 0);
    const sampleVoyage = sampleDeparture?.voyage ?? sdk.voyages.find((v) => v.departures.length > 0) ?? sdk.voyages[0];

    check('dataset has a priced departure to work with', !!sampleDeparture && !!sampleOffering && !!sampleCurrency);

    // 03 — Stats. Assert internal consistency, not specific counts.
    example(3, 'Read stats');
    const stats = sdk.stats;
    show(`${stats.voyageCount} voyages · ${stats.shipCount} ships · ${stats.offeringCount} offerings`);
    check('there is data loaded', stats.voyageCount > 0);
    check('stats match the collections', stats.voyageCount === sdk.voyages.length && stats.departureCount === sdk.departures.length && stats.offeringCount === sdk.offerings.length);

    // 04 — Collections are plain arrays of objects.
    example(4, 'Access a collection');
    show(`voyages[0] = "${sdk.voyages[0].heading}"`);
    check('sdk.voyages is indexable and matches the count', sdk.voyages.length === stats.voyageCount && !!sdk.voyages[0]);

    // 05 — Objects expose typed getters.
    example(5, "Read an object's properties");
    show(`heading="${sampleVoyage.heading}"  duration="${sampleVoyage.durationText}"`);
    check('voyage.heading is a string', typeof sampleVoyage.heading === 'string');
    check('voyage.durationText is a string', typeof sampleVoyage.durationText === 'string');

    // 06 — Look an entity up by id; the lookup returns the same object.
    example(6, 'Look up a ship by id');
    show(`sdk.ship("${sampleShip.id}") -> ${sampleShip.name}`);
    check('sdk.ship(id) round-trips to the same instance', sdk.ship(sampleShip.id) === sampleShip);

    // 07 — Look an entity up by code; date is parsed from the code.
    example(7, 'Look up a departure by tour code');
    show(`sdk.departure("${sampleDeparture.code}") -> date ${sampleDeparture.date}`);
    check('sdk.departure(code) round-trips to the same instance', sdk.departure(sampleDeparture.code) === sampleDeparture);
    check('departure.date is null or an ISO date', sampleDeparture.date === null || DATE_RE.test(sampleDeparture.date));

    // 08 — Objects have behaviour (methods), not just data.
    example(8, 'Objects have methods, not just fields');
    check('voyage.upcomingDepartures is a function', typeof sampleVoyage.upcomingDepartures === 'function');
    check('cabinGrade.descriptionsForShip is a function', typeof sampleGrade.descriptionsForShip === 'function');

    // =======================================================================
    // TRAVERSAL (9–16)
    // =======================================================================

    // 09 — Forward, plus an ownership invariant across the whole catalog.
    example(9, 'Navigate voyage → departures');
    const ownedDepartures = sdk.voyages.reduce((n, v) => n + v.departures.length, 0);
    show(`"${sampleVoyage.heading}" has ${sampleVoyage.departures.length} departures`);
    check('every departure is owned by exactly one voyage', ownedDepartures === sdk.departures.length);

    // 10 — A filtering method: upcoming-only.
    example(10, 'Filter with a method (upcoming only)');
    const upcoming = sampleVoyage.upcomingDepartures(TODAY);
    show(`${upcoming.length} of ${sampleVoyage.departures.length} departures upcoming as of ${TODAY}`);
    check('upcoming is a subset', upcoming.length <= sampleVoyage.departures.length);
    check('every upcoming departure is on/after today', upcoming.every((d) => d.date === null || d.date >= TODAY));

    // 11 — Forward then reverse-consistency: departure ↔ ship.
    example(11, 'Navigate departure → ship');
    show(`${sampleDeparture.code} sails on ${sampleDeparture.ship.name}`);
    check("departure.ship lists the departure back (ship.departures includes it)", sampleDeparture.ship.departures.includes(sampleDeparture));

    // 12 — Into the join: departure → offerings → grades is the distinct set.
    example(12, 'Navigate departure → offerings → cabin grades');
    const gradesFromOfferings = new Set(sampleDeparture.offerings.map((o) => o.cabinGrade).filter(Boolean));
    show(`grades on ${sampleDeparture.code}: ${sampleDeparture.cabinGrades.map((g) => g.code).join(', ')}`);
    check('departure.cabinGrades equals the distinct grades of its offerings', sampleDeparture.cabinGrades.length === gradesFromOfferings.size && sampleDeparture.cabinGrades.every((g) => gradesFromOfferings.has(g)));

    // 13 — Leaf data: an offering's price (any currency present) & description.
    example(13, "Read an offering's price & description");
    const price = sampleOffering.priceFor(sampleCurrency);
    show(`${sampleOffering.code} ${sampleCurrency} (double) = ${price.double}`);
    check('priceFor(currency) returns the matching price entry', price && price.currency === sampleCurrency);
    check('that currency is one of the offering.prices', sampleOffering.prices.some((p) => p.currency === sampleCurrency));
    check('description is an array', Array.isArray(sampleOffering.description));

    // 14 — Reverse: cabin grade → the ships that offer it (consistent both ways).
    example(14, 'Reverse: cabin grade → ships');
    show(`${sampleGrade.code} is offered on ships: ${sampleGrade.ships.map((s) => s.id).join(', ') || '(none)'}`);
    check('every ship that lists this grade also has the grade in ship.cabinGrades', sampleGrade.ships.every((s) => s.cabinGrades.includes(sampleGrade)));

    // 15 — Reverse: ship → voyages (each derived from a real departure).
    example(15, 'Reverse: ship → voyages');
    show(`${sampleShip.name} sails ${sampleShip.voyages.length} voyages`);
    check('every voyage of a ship has a departure on that ship', sampleShip.voyages.every((v) => v.departures.some((d) => d.ship === sampleShip)));

    // 16 — Identity: related objects are the SAME instance (===), not copies.
    example(16, 'Round-trip identity (===)');
    check('departure.voyage.departures includes the departure', sampleDeparture.voyage.departures.includes(sampleDeparture));
    check('offering.departure lists the offering back (===)', sampleOffering.departure.offerings.includes(sampleOffering));
    check('grade.offerings includes the offering pointing back to it', !sampleOffering.cabinGrade || sampleOffering.cabinGrade.offerings.includes(sampleOffering));

    // =======================================================================
    // QUERIES & CORRECTNESS (17–20): self-checking aggregations.
    // =======================================================================

    // 17 — Cheapest cabin on a departure (and prove it's really the minimum).
    example(17, 'Cheapest cabin on a departure');
    const priced = sampleDeparture.offerings.filter((o) => o.priceFor(sampleCurrency));
    const cheapestCabin = [...priced].sort((a, b) => a.priceFor(sampleCurrency).double - b.priceFor(sampleCurrency).double)[0];
    show(`cheapest on ${sampleDeparture.code}: ${cheapestCabin.code} @ ${sampleCurrency} ${cheapestCabin.priceFor(sampleCurrency).double}`);
    check('no offering on this departure is cheaper', priced.every((o) => o.priceFor(sampleCurrency).double >= cheapestCabin.priceFor(sampleCurrency).double));

    // 18 — Cheapest departure of a voyage (min across each departure).
    example(18, 'Cheapest departure of a voyage');
    const minPrice = (d) => {
        const ps = d.offerings.map((o) => o.priceFor(sampleCurrency)?.double).filter((p) => p != null);
        return ps.length ? Math.min(...ps) : Infinity;
    };
    const pricedUpcoming = sampleVoyage.upcomingDepartures(TODAY).filter((d) => minPrice(d) < Infinity);
    if (pricedUpcoming.length) {
        const cheapestDep = [...pricedUpcoming].sort((a, b) => minPrice(a) - minPrice(b))[0];
        show(`cheapest upcoming: ${cheapestDep.date} from ${sampleCurrency} ${minPrice(cheapestDep)}`);
        check('cheapest departure is really the minimum', pricedUpcoming.every((d) => minPrice(d) >= minPrice(cheapestDep)));
    } else {
        show('(no priced upcoming departures for this voyage)');
        check('handled voyage with no priced upcoming departures', true);
    }

    // 19 — Catalog-wide aggregate: voyages per ship + a containment invariant.
    example(19, 'Aggregate: voyages per ship');
    show(sdk.ships.map((s) => `${s.id}:${s.voyages.length}`).join('  '));
    const allShipVoyages = new Set(sdk.ships.flatMap((s) => [...s.voyages]));
    check('every ship-reachable voyage is a real catalog voyage', [...allShipVoyages].every((v) => sdk.voyages.includes(v)));

    // 20 — Cross-entity query: cheapest <currency> per grade across one ship.
    example(20, `Cross-entity query: cheapest ${sampleCurrency} per grade on ${sampleShip.id}`);
    const cheapestByGrade = {};
    for (const d of sampleShip.departures) {
        for (const o of d.offerings) {
            const p = o.priceFor(sampleCurrency)?.double;
            if (p == null) continue;
            if (cheapestByGrade[o.code] == null || p < cheapestByGrade[o.code]) cheapestByGrade[o.code] = p;
        }
    }
    show(
        Object.entries(cheapestByGrade)
            .sort()
            .map(([g, p]) => `${g}:${p}`)
            .join('  ') || '(no priced offerings on this ship)'
    );
    check('every per-grade minimum is positive', Object.values(cheapestByGrade).every((p) => p > 0));

    // =======================================================================
    console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}Summary: ${passed} passed, ${failed} failed\x1b[0m`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((ex) => {
    console.error(`FATAL: ${ex.message}`);
    console.error(ex.stack);
    process.exit(1);
});
