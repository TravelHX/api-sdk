import {
    createApiSdk,
    resolveDataSourceFormat,
    resolveMarket,
    resolveLocale,
    resolveMarketDataSources,
    resolveMarketDataSourcesV3,
    MARKET_LOCALES,
    MARKET_LOCALES_V3,
    DATASOURCE_FORMAT_ENV,
    DATASOURCE_MARKET_ENV,
    DATASOURCE_LOCALE_ENV,
} from '@api-sdk/js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import * as tui from './tui.js';

/** @typedef {import('@api-sdk/js').IApiSdk} IApiSdk */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getProjectRoot() {
    // In Docker we're at /app/js-testrunner; locally at utils/js.
    if (__dirname.startsWith('/app')) return '/app';
    return path.resolve(__dirname, '..', '..');
}

function loadConfig() {
    const configPath = path.join(getProjectRoot(), 'config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config) throw new Error('Failed to parse configuration file');
    return config;
}

// --- text helpers -----------------------------------------------------------

function wrapText(text, width = 76) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
        if (line && (line.length + 1 + word.length) > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function formatPrice(value) {
    const n = parseFloat(value);
    if (isNaN(n)) return null;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPriceLines(label, priceMap, indent) {
    const currencies = Object.keys(priceMap).sort();
    if (currencies.length === 0) return [`${indent}${label} n/a`];
    const parts = currencies.map((c) => `${c} ${formatPrice(priceMap[c])}`);
    const lines = [];
    let line = '';
    const max = 60;
    for (const part of parts) {
        if (line && (line.length + 3 + part.length) > max) {
            lines.push(line);
            line = part;
        } else {
            line = line ? `${line}   ${part}` : part;
        }
    }
    if (line) lines.push(line);
    const padded = ' '.repeat(label.length + 1);
    return lines.map((l, i) => `${indent}${i === 0 ? `${label} ` : padded}${l}`);
}

// --- line builders for the views -------------------------------------------

function configLines(config) {
    const t = config?.testData || {};
    const o = config?.output || {};
    const lines = [
        `Base path:             ${t.basePath}`,
        `Show call details:     ${o.showCallDetails ?? true}`,
        `Show response details: ${o.showResponseDetails ?? true}`,
        `Show timing:           ${o.showTiming ?? true}`,
        `Test files:            ${t.files?.length ?? 0}`,
        '',
    ];
    (t.files || []).forEach((f, i) => {
        lines.push(`${i + 1}. ${f.name} — ${f.description || ''}`);
        lines.push(`     ${f.path}`);
    });
    return lines;
}

function suiteLines(suite) {
    if (!suite) return ['No test suite selected.'];
    const lines = [`Base path: ${suite.basePath}`, `Files: ${suite.files?.length || 0}`, ''];
    (suite.files || []).forEach((f, i) => lines.push(`${i + 1}. ${f.name} — ${f.path}`));
    lines.push('');
    lines.push('Note: edit config.json and restart to change the suite.');
    return lines;
}

/**
 * Runs usageCase.js directly as a subprocess and returns its output as plain lines.
 * usageCase.js is the single source of truth for the example/test suite; we capture
 * its stdout (stripping colour) rather than importing it — it calls
 * process.exit(), which would otherwise terminate the CLI.
 */
function runUsageSuite() {
    return new Promise((resolve) => {
        execFile(
            process.execPath, // the same node binary running this CLI
            ['usageCase.js'],
            { cwd: __dirname, maxBuffer: 16 * 1024 * 1024 },
            (err, stdout, stderr) => {
                const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
                const text = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`;
                const lines = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+$/, '').split('\n');
                resolve({ lines, code });
            }
        );
    });
}

function voyageDetail(voyage, today) {
    const lines = [];
    if (voyage.durationText) lines.push(`Duration: ${voyage.durationText}`);
    lines.push(`Upcoming departures: ${voyage.upcomingDepartures(today).length}`);
    lines.push('');
    if (voyage.intro) {
        lines.push('Intro:');
        for (const l of wrapText(voyage.intro, 40)) lines.push(`  ${l}`);
        lines.push('');
    }
    if (voyage.sellingPoints?.length) {
        lines.push('Selling points:');
        for (const p of voyage.sellingPoints) {
            const wrapped = wrapText(p, 38);
            lines.push(`  • ${wrapped[0]}`);
            for (const cont of wrapped.slice(1)) lines.push(`    ${cont}`);
        }
    }
    return lines;
}

function departureDetail(d) {
    const lines = [
        `Code:  ${d.code}`,
        `Ship:  ${d.ship ? `${d.ship.name} (${d.ship.id})` : d.shipCode}`,
    ];
    if (d.endDate) lines.push(`Dates: ${d.date} → ${d.endDate}`);
    lines.push(`Cabin grades: ${d.cabinGrades.length}`);
    return lines;
}

function cabinLines(departure) {
    const ship = departure.ship;
    const cabins = [...departure.offerings].sort((a, b) => a.code.localeCompare(b.code));
    const lines = [
        `Ship:      ${ship ? `${ship.name} (${ship.id})` : departure.shipCode}`,
        `Departure: ${departure.date}${departure.endDate ? ` → ${departure.endDate}` : ''}   (${departure.code})`,
        '',
    ];
    if (!cabins.length) {
        lines.push('No cabins or pricing available for this departure.');
        return lines;
    }
    lines.push(`Cabins (${cabins.length}):`);
    lines.push('');
    cabins.forEach((c, i) => {
        lines.push(`${String(i + 1).padStart(2)}. ${c.name ? `${c.code} - ${c.name}` : c.code}`);
        const descs = c.description;
        if (descs.length) {
            for (const d of descs) for (const l of wrapText(d, 72)) lines.push(`      ${l}`);
        } else {
            lines.push('      (no cabin description available)');
        }
        if (c.availableCabins !== undefined && c.availableCabins !== null) {
            lines.push(`      Available cabins: ${c.availableCabins}`);
        }
        const dbl = {};
        const sgl = {};
        for (const p of c.prices) {
            if (p.double !== null) dbl[p.currency] = p.double;
            if (p.single !== null) sgl[p.currency] = p.single;
        }
        for (const l of formatPriceLines('Double (pp):', dbl, '      ')) lines.push(l);
        for (const l of formatPriceLines('Single:     ', sgl, '      ')) lines.push(l);
        lines.push('');
    });
    return lines;
}

// --- startup wizard -----------------------------------------------------------
//
// Interactive selection, mirroring the "Browse data" flow's use of
// tui.runList: DATASOURCE_FORMAT/DATASOURCE_MARKET/DATASOURCE_LOCALE remain a
// valid shortcut (skip the corresponding prompt when already validly set —
// handy for scripted/non-interactive use) but are never required. Missing or
// invalid env values fall through to a menu instead of throwing.
//
// Thrown to unwind out of the wizard when the user backs out (q/esc) of a
// mandatory step (format/market/locale) before any menu exists to return to.
// Caught in main() and treated as a quiet exit, not a crash.
class QuitRequested extends Error {}

/**
 * Runs an env-driven resolver (resolveDataSourceFormat / resolveMarket, both
 * of which throw on unset/invalid) and converts the throw into a result
 * object instead of swallowing it — so a bad env value can be surfaced to the
 * user (as a startup note, see loadSdkData) rather than silently falling
 * through to the prompt with no explanation.
 */
function tryResolve(resolver, env = process.env) {
    try {
        return { value: resolver(env), warning: null };
    } catch (ex) {
        return { value: null, warning: ex.message };
    }
}

function localesFor(format, market) {
    return format === 'v3' ? MARKET_LOCALES_V3[market] : MARKET_LOCALES[market];
}

/**
 * Guard at the top of every select*Prompt(): an interactive tui.runList
 * prompt is only meaningful with a real terminal on stdin. Piped/redirected
 * stdin (CI, `node SDKCLI.js < /dev/null`, scripted invocation) never
 * delivers a keypress, so the prompt's promise would simply hang forever —
 * and since nothing else keeps the event loop alive once stdin hits EOF,
 * the process would exit 0 with no data loaded and no error, reporting
 * false success on what is really a configuration error. Fail loudly
 * instead, exactly like the pre-wizard resolveDataSourceFormat()/
 * resolveMarket() throw-on-missing behavior did for non-interactive callers.
 */
function requireInteractiveOrFail(envVar, reason) {
    if (!process.stdin.isTTY) {
        throw new Error(
            `${envVar} ${reason} and stdin is not a TTY, so the interactive selection ` +
                `prompt can't run. Set ${envVar} explicitly for non-interactive/scripted use.`
        );
    }
}

async function selectFormatPrompt() {
    requireInteractiveOrFail(DATASOURCE_FORMAT_ENV, 'is not set (or not "v1"/"v3")');
    const options = [
        {
            value: 'v1',
            label: 'v1 · dev',
            desc: [
                'The original flat-file format.',
                'data/flatfiles_dev — per-currency SourceMarket rate files,',
                'separate cabin-grade reference.',
            ],
        },
        {
            value: 'v3',
            label: 'v3 · prod',
            desc: [
                'The per-voyage-priced flat-file format.',
                'data/flatfiles_prod — pricing embedded per voyage,',
                'no separate cabin-grade reference.',
            ],
        },
    ];
    const i = await tui.runList({
        title: 'Select format',
        items: options,
        renderItem: (o) => o.label,
        renderDetail: (o) => o.desc,
        footer: 'arrows/jk move · enter select · q quit',
    });
    if (i === -1) throw new QuitRequested();
    return options[i].value;
}

async function selectMarketPrompt(format) {
    requireInteractiveOrFail(DATASOURCE_MARKET_ENV, 'is not set (or not a recognized market)');
    // Both formats' tables share the same Market keys (see marketConfig.ts) —
    // MARKET_LOCALES is the source of truth so this list can't drift from it.
    const markets = Object.keys(MARKET_LOCALES);
    const i = await tui.runList({
        title: 'Select market',
        items: markets,
        renderItem: (m) => m,
        renderDetail: (m) => [`Locales (${format}): ${localesFor(format, m).join(', ')}`],
        footer: 'arrows/jk move · enter select · q quit',
    });
    if (i === -1) throw new QuitRequested();
    return markets[i];
}

async function selectLocalePrompt(market, locales) {
    requireInteractiveOrFail(
        DATASOURCE_LOCALE_ENV,
        `is required for market "${market}" (which has multiple locales: ${locales.join(', ')}) but not set (or invalid)`
    );
    const i = await tui.runList({
        title: `Select locale — ${market}`,
        items: locales,
        renderItem: (l) => l,
        footer: 'arrows/jk move · enter select · q quit',
    });
    if (i === -1) throw new QuitRequested();
    return locales[i];
}

/**
 * Build the full {@link DataSources} path set (minus `format`) for
 * {@link format}/{@link market}/{@link locale} against {@link baseDir}, plus
 * the subset of those paths that must actually exist on disk for that
 * format's loader (V1DataSetLoader reads voyages/ships/cabinGrades/ports/every
 * sourceMarkets file; V3DataSetLoader reads only voyages/ships/ports — it
 * never touches cabinGrades/sourceMarkets, so those aren't checked for v3).
 */
function buildSources(format, market, locale, baseDir) {
    if (format === 'v3') {
        // Prod fixtures live flat under data/flatfiles_prod/flatfiles_prod (no
        // RefData subfolder, uppercase 2-letter country codes, no `_seaware`
        // suffix).
        const { voyages, ships } = resolveMarketDataSourcesV3(market, locale, baseDir);
        const ports = path.join(baseDir, 'ports.json');
        return {
            sources: { voyages, ships, cabinGrades: '', ports, sourceMarkets: [] },
            filesToCheck: [voyages, ships, ports],
        };
    }
    const { voyages, ships, sourceMarkets } = resolveMarketDataSources(market, locale, baseDir);
    const cabinGrades = path.join(baseDir, 'cabingrades.json');
    const ports = path.join(baseDir, 'portlist.json');
    return {
        sources: { voyages, ships, cabinGrades, ports, sourceMarkets },
        filesToCheck: [voyages, ships, cabinGrades, ports, ...sourceMarkets],
    };
}

/**
 * Resolve the full {@link DataSources} path set for {@link format}/
 * {@link market}/{@link locale} against {@link defaultBaseDir}. If any file
 * the loader actually reads doesn't exist on disk, prompts (tui.runInput) for
 * a replacement directory and retries — this is the ONE recoverable failure
 * case; everything else about market/locale is just menu selection, never
 * free text.
 *
 * @returns {Promise<{baseDir: string, sources: object}|null>} null if the
 *   user cancelled the directory prompt (esc) — caller skips loading rather
 *   than crashing or force-quitting the CLI.
 */
async function resolveBaseDirInteractively(format, market, locale, defaultBaseDir) {
    let baseDir = defaultBaseDir;

    while (true) {
        const { sources, filesToCheck } = buildSources(format, market, locale, baseDir);

        const missing = filesToCheck.filter((f) => !fs.existsSync(f));
        if (missing.length === 0) {
            return { baseDir, sources };
        }

        // Same non-interactive hazard as the format/market/locale prompts
        // (see requireInteractiveOrFail): without a TTY there's no one to
        // type a replacement directory, so fail loudly here too rather than
        // hanging or silently reporting success with nothing loaded.
        if (!process.stdin.isTTY) {
            throw new Error(
                `Data files not found for format="${format}" market="${market}" locale="${locale}": ` +
                    `missing ${missing.join(', ')}. Tried "${baseDir}". stdin is not a TTY, so the ` +
                    `interactive directory prompt can't run.`
            );
        }

        const input = await tui.runInput({
            title: 'Data files not found',
            info: [
                `Missing: ${missing.map((f) => path.basename(f)).join(', ')}`,
                `Tried:   ${baseDir}`,
            ],
            label: 'New directory: ',
            footer: 'enter confirm · esc skip loading',
        });
        if (input === null || input.trim().length === 0) {
            return null;
        }
        baseDir = path.resolve(input.trim());
    }
}

/**
 * @param {object} config
 * @param {IApiSdk} sdk
 */
async function loadSdkData(config, sdk, projectRoot) {
    // Startup notes (invalid/ignored env values) — shown on the loading
    // screen below rather than lost behind the alt-screen buffer.
    const notes = [];

    // Env vars remain a valid shortcut: skip a prompt only when the
    // corresponding value is ALREADY validly set for the choices made so far.
    // An unset value is normal (no note); an INVALID one is surfaced so the
    // bad value doesn't silently vanish.
    const formatResult = tryResolve(resolveDataSourceFormat);
    let format = formatResult.value;
    if (formatResult.warning && process.env[DATASOURCE_FORMAT_ENV]) {
        notes.push(`DATASOURCE_FORMAT ignored: ${formatResult.warning}`);
    }
    if (!format) format = await selectFormatPrompt();

    const marketResult = tryResolve(resolveMarket);
    let market = marketResult.value;
    if (marketResult.warning && process.env[DATASOURCE_MARKET_ENV]) {
        notes.push(`DATASOURCE_MARKET ignored: ${marketResult.warning}`);
    }
    if (!market) market = await selectMarketPrompt(format);

    // Locale prompt only when the market has more than one locale for this
    // format (mirrors the resolver: a single-locale market is never asked).
    const locales = localesFor(format, market);
    let locale;
    if (locales.length === 1) {
        locale = locales[0];
        const envLocale = resolveLocale();
        if (envLocale) {
            notes.push(
                `DATASOURCE_LOCALE="${envLocale}" ignored: market "${market}" has only one locale (${locale}).`
            );
        }
    } else {
        const envLocale = resolveLocale();
        const match = envLocale && locales.find((l) => l.toLowerCase() === envLocale.toLowerCase());
        if (envLocale && !match) {
            notes.push(
                `DATASOURCE_LOCALE="${envLocale}" ignored: not valid for market "${market}" (expected one of ${locales.join(', ')}).`
            );
        }
        locale = match || (await selectLocalePrompt(market, locales));
    }

    const defaultBaseDir =
        format === 'v3'
            ? path.resolve(path.join(projectRoot, 'data', 'flatfiles_prod', 'flatfiles_prod'))
            : path.resolve(path.join(projectRoot, config?.testData?.basePath || '', 'RefData'));

    const resolution = await resolveBaseDirInteractively(format, market, locale, defaultBaseDir);

    // Kept separate from the scrolling progress log (not merged then
    // windowed together): notes surface a bad/ignored env value, which
    // matters regardless of how many "Loading X..." lines follow, so they
    // must never be the ones a trailing .slice() window happens to push out.
    const progressLog = [];
    const onProgress = (msg) => {
        progressLog.push(msg);
        tui.render('API SDK CLI — loading', [...notes, ...progressLog.slice(-18)]);
    };

    if (!resolution) {
        tui.render('API SDK CLI — not loaded', [
            ...notes,
            'No data directory provided — skipping load.',
            '',
            'Press any key to continue…',
        ]);
        await tui.waitKey();
        return;
    }

    const { sources } = resolution;

    try {
        await sdk.load({ format, ...sources }, onProgress);
    } catch (ex) {
        progressLog.push(`FAILED: ${ex.message}`);
    }

    const s = sdk.stats;
    tui.render('API SDK CLI — loaded', [
        ...notes,
        ...progressLog.slice(-12),
        '',
        `${s.voyageCount} voyages · ${s.shipCount} ships · ${s.cabinGradeCount} cabin grades · ${s.portCount} ports`,
        `${s.departureCount} departures · ${s.offeringCount} cabin offerings`,
        '',
        'Press any key to continue…',
    ]);
    await tui.waitKey();
}

// --- browse flow ------------------------------------------------------------

/** @param {IApiSdk} sdk */
async function browse(sdk) {
    if (!sdk.isLoaded || sdk.voyages.length === 0) {
        await tui.runPager({ title: 'Browse', lines: ['No SDK data loaded.'] });
        return;
    }
    const today = new Date().toISOString().slice(0, 10);

    while (true) {
        const vi = await tui.runList({
            title: `Voyages (${sdk.stats.voyageCount})`,
            items: sdk.voyages,
            renderItem: (v) => v.heading || '(no heading)',
            renderDetail: (v) => voyageDetail(v, today),
            footer: 'arrows/jk move · enter departures · q back',
        });
        if (vi === -1) return;
        await selectDeparture(sdk.voyages[vi], today);
    }
}

async function selectDeparture(voyage, today) {
    const departures = voyage.upcomingDepartures(today);
    while (true) {
        if (departures.length === 0) {
            await tui.runPager({ title: voyage.heading, lines: ['No upcoming departures.'] });
            return;
        }
        const di = await tui.runList({
            title: voyage.heading,
            items: departures,
            renderItem: (d) => `${d.date}${d.endDate ? ` → ${d.endDate}` : ''}`,
            renderDetail: (d) => departureDetail(d),
            footer: 'arrows/jk move · enter cabins · q back',
        });
        if (di === -1) return;
        const d = departures[di];
        await tui.runPager({
            title: `${voyage.heading} — ${d.date}`,
            lines: cabinLines(d),
            footer: 'arrows/jk scroll · q back',
        });
    }
}

// --- main menu --------------------------------------------------------------

const MENU = [
    { key: 'config', label: '0 · Show configuration', desc: 'Display basePath, output flags and the configured test files.' },
    { key: 'tests', label: '1 · Run all automated tests', desc: 'Read each configured flat file through the SDK and report pass/fail.' },
    { key: 'suite', label: '2 · Specify test file suite location / name', desc: 'Show the active test suite from config.json.' },
    { key: 'browse', label: '3 · Browse data', desc: 'Explore voyages, departures and cabins from the loaded SDK graph.' },
    { key: 'exit', label: '4 · Exit', desc: 'Leave the CLI.' },
];

async function main() {
    const projectRoot = getProjectRoot();
    const config = loadConfig();
    /** @type {IApiSdk} */
    const sdk = createApiSdk();
    const selectedSuite = config?.testData;

    tui.start();
    tui.enterFullscreen();
    try {
        await loadSdkData(config, sdk, projectRoot);

        let running = true;
        while (running) {
            const idx = await tui.runList({
                title: 'API SDK CLI',
                items: MENU,
                renderItem: (m) => m.label,
                renderDetail: (m) => wrapText(m.desc, 40),
                footer: 'arrows/jk move · enter select · q quit',
            });
            const item = idx === -1 ? MENU[MENU.length - 1] : MENU[idx];

            switch (item.key) {
                case 'config':
                    await tui.runPager({ title: 'Configuration', lines: configLines(config) });
                    break;
                case 'tests': {
                    tui.render('Automated Tests', ['Running usageCase.js suite…']);
                    const { lines, code } = await runUsageSuite();
                    await tui.runPager({
                        title: `Automated Tests — usageCase.js (exit ${code})`,
                        lines,
                        footer: 'arrows/jk scroll · q back',
                    });
                    break;
                }
                case 'suite':
                    await tui.runPager({ title: 'Test Suite', lines: suiteLines(selectedSuite) });
                    break;
                case 'browse':
                    await browse(sdk);
                    break;
                case 'exit':
                    running = false;
                    break;
            }
        }
    } catch (ex) {
        // The user backed out (q/esc) of a mandatory format/market/locale
        // prompt during startup, before any menu existed to return to. Quiet
        // exit, not a crash.
        if (!(ex instanceof QuitRequested)) throw ex;
    } finally {
        tui.exitFullscreen();
        tui.stop();
    }
}

main().catch((ex) => {
    tui.exitFullscreen();
    tui.stop();
    console.error(`FATAL ERROR: ${ex.message}`);
    console.error(ex.stack);
    process.exit(1);
});
