import { createApiSdk } from '@api-sdk/js';
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
 * Runs usage.js directly as a subprocess and returns its output as plain lines.
 * usage.js is the single source of truth for the example/test suite; we capture
 * its stdout (stripping colour) rather than importing it — it calls
 * process.exit(), which would otherwise terminate the CLI.
 */
function runUsageSuite() {
    return new Promise((resolve) => {
        execFile(
            process.execPath, // the same node binary running this CLI
            ['usage.js'],
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

// --- startup load -----------------------------------------------------------

/**
 * @param {object} config
 * @param {IApiSdk} sdk
 */
async function loadSdkData(config, sdk, projectRoot) {
    const basePath = config?.testData?.basePath || '';
    const refDataDir = path.resolve(path.join(projectRoot, basePath, 'RefData'));

    let sourceMarkets = [];
    try {
        sourceMarkets = fs
            .readdirSync(refDataDir)
            .filter((f) => /^SourceMarket_.*_seaware\.json$/.test(f))
            .sort()
            .map((f) => path.join(refDataDir, f));
    } catch {
        /* discovery failure handled below via empty stats */
    }

    const sources = {
        voyages: path.join(refDataDir, 'voyages.json'),
        ships: path.join(refDataDir, 'ships.json'),
        cabinGrades: path.join(refDataDir, 'cabingrades.json'),
        ports: path.join(refDataDir, 'portlist.json'),
        sourceMarkets,
    };

    const log = [];
    const onProgress = (msg) => {
        log.push(msg);
        tui.render('API SDK CLI — loading', log.slice(-18));
    };

    try {
        await sdk.load(sources, onProgress);
    } catch (ex) {
        log.push(`FAILED: ${ex.message}`);
    }

    const s = sdk.stats;
    tui.render('API SDK CLI — loaded', [
        ...log.slice(-12),
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
                    tui.render('Automated Tests', ['Running usage.js suite…']);
                    const { lines, code } = await runUsageSuite();
                    await tui.runPager({
                        title: `Automated Tests — usage.js (exit ${code})`,
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
