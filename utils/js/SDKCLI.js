import { createApiSdk } from '@api-sdk/js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/** @typedef {import('@api-sdk/js').IApiSdk} IApiSdk */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getProjectRoot() {
    // In Docker, we're at /app/js-testrunner, so go up to /app
    // In local, we're at utils/js, so go up to repo root
    if (__dirname.startsWith('/app')) {
        return '/app';
    }
    return path.resolve(__dirname, '..', '..');
}

function loadConfig() {
    const configPath = path.join(getProjectRoot(), 'config.json');
    
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
    }

    const jsonContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(jsonContent);

    if (!config) {
        throw new Error('Failed to parse configuration file');
    }

    return config;
}

function printHeader() {
    console.clear();
    console.log('========================================');
    console.log('API SDK CLI');
    console.log('========================================');
    console.log();
}

function printMenu(selectedSuite) {
    console.log('Available Commands:');
    console.log('  0 - Show configuration');
    console.log('  1 - Run All Automated Tests');
    const suiteDisplay = selectedSuite ? ` (${selectedSuite.basePath || 'default'})` : '';
    console.log(`  2 - Specify Test File Suite Location / name${suiteDisplay}`);
    console.log('  3 - Browse data');
    console.log('  4 - Exit');
    console.log();
    process.stdout.write('Enter command (0-4): ');
}

function listTestFiles(config) {
    console.log();
    console.log('Available Test Files:');
    console.log('---------------------');
    
    if (!config?.testData?.files || config.testData.files.length === 0) {
        console.log('No test files configured.');
        return;
    }

    config.testData.files.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file.name} - ${file.description || 'No description'}`);
        console.log(`     Path: ${file.path}`);
    });
    console.log();
}

function showConfiguration(config, selectedSuite) {
    console.log();
    console.log('Current Configuration:');
    console.log('---------------------');
    console.log(`Base Path: ${config?.testData?.basePath}`);
    console.log(`Show Call Details: ${config?.output?.showCallDetails ?? true}`);
    console.log(`Show Response Details: ${config?.output?.showResponseDetails ?? true}`);
    console.log(`Show Timing: ${config?.output?.showTiming ?? true}`);
    console.log(`Number of Test Files: ${config?.testData?.files?.length ?? 0}`);
    if (selectedSuite) {
        console.log(`Selected Test Suite: ${selectedSuite.basePath}`);
        console.log(`Selected Suite Files: ${selectedSuite.files?.length || 0}`);
    }
    console.log();
}

async function runTestFile(fileConfig, config, sdk) {
    if (!sdk || !config?.testData) {
        console.log('ERROR: SDK or configuration not initialized');
        return false;
    }

    const projectRoot = getProjectRoot();
    const fullPath = path.join(projectRoot, config.testData.basePath || '', fileConfig.path || '');
    const resolvedPath = path.resolve(fullPath);

    console.log();
    console.log('========================================');
    console.log(`Running Test: ${fileConfig.name}`);
    console.log('========================================');
    console.log(`File Path: ${resolvedPath}`);
    console.log(`Description: ${fileConfig.description || 'No description'}`);
    console.log();

    if (!fs.existsSync(resolvedPath)) {
        console.error(`\x1b[31mERROR: File not found: ${resolvedPath}\x1b[0m`);
        console.log();
        return false;
    }

    const startTime = Date.now();

    try {
        // Show call details
        if (config.output?.showCallDetails ?? true) {
            console.log('\x1b[36mCALL:\x1b[0m');
            console.log(`  Method: readFile`);
            console.log(`  File Path: ${resolvedPath}`);
            console.log(`  Timestamp: ${new Date().toISOString()}`);
            console.log();
        }

        // Read file as string
        const content = await sdk.readFile(resolvedPath);
        const duration = Date.now() - startTime;

        // Show response details
        if (config.output?.showResponseDetails ?? true) {
            console.log('\x1b[32mRESPONSE:\x1b[0m');
            console.log(`  Status: Success`);
            console.log(`  Content Length: ${content.length} characters`);
            
            if (config.output?.showTiming ?? true) {
                console.log(`  Duration: ${duration} ms`);
            }
            
            // Show preview of content (first 200 characters)
            const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
            console.log(`  Content Preview: ${preview}`);
            console.log();
        }

        // Try to parse as JSON array to show item count
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                console.log('\x1b[33mPARSED DATA:\x1b[0m');
                console.log(`  Type: JSON Array`);
                console.log(`  Item Count: ${parsed.length}`);
                console.log();
            }
        } catch (err) {
            // Not valid JSON or not an array, that's okay
        }

        console.log('\x1b[32mTEST PASSED\x1b[0m');
        console.log();
        return true;
    } catch (ex) {
        const duration = Date.now() - startTime;
        console.log('\x1b[31mRESPONSE:\x1b[0m');
        console.log(`  Status: Error`);
        console.log(`  Error Type: ${ex.constructor.name}`);
        console.log(`  Error Message: ${ex.message}`);
        
        if (config.output?.showTiming ?? true) {
            console.log(`  Duration: ${duration} ms`);
        }
        console.log();

        console.log('\x1b[31mTEST FAILED\x1b[0m');
        console.log();
        return false;
    }
}

async function runAllTests(config, sdk) {
    if (!config?.testData?.files || config.testData.files.length === 0) {
        console.log('No test files configured.');
        return;
    }

    console.log();
    console.log(`Running ${config.testData.files.length} test file(s)...`);
    console.log();

    const totalStartTime = Date.now();
    let passed = 0;
    let failed = 0;

    for (const fileConfig of config.testData.files) {
        try {
            const ok = await runTestFile(fileConfig, config, sdk);
            if (ok) passed++; else failed++;
        } catch (ex) {
            console.error(`\x1b[31mFailed to run test for ${fileConfig.name}: ${ex.message}\x1b[0m`);
            failed++;
        }
    }

    const totalDuration = Date.now() - totalStartTime;

    console.log('========================================');
    console.log('Test Run Summary');
    console.log('========================================');
    console.log(`Total Tests: ${config.testData.files.length}`);
    console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
    console.log(`Total Duration: ${totalDuration} ms`);
    console.log();
}

function waitForInput() {
    return new Promise((resolve) => {
        process.stdin.once('data', () => {
            resolve();
        });
    });
}

function specifyTestSuite(selectedSuite) {
    console.log();
    console.log('Current Test Suite:');
    console.log('-------------------');
    if (selectedSuite) {
        console.log(`Base Path: ${selectedSuite.basePath}`);
        console.log(`Number of Files: ${selectedSuite.files?.length || 0}`);
        if (selectedSuite.files && selectedSuite.files.length > 0) {
            console.log('Files:');
            selectedSuite.files.forEach((file, index) => {
                console.log(`  ${index + 1}. ${file.name} - ${file.path}`);
            });
        }
    } else {
        console.log('No test suite selected.');
    }
    console.log();
    console.log('Note: Currently using the test suite from config.json.');
    console.log('To change the suite, modify config.json and restart the application.');
    console.log();
}

// ---------------------------------------------------------------------------
// Option 6: browse the SDK's data graph
// ---------------------------------------------------------------------------

/**
 * Reads a single line of input from stdin.
 */
function readLine() {
    return new Promise((resolve) => {
        process.stdin.once('data', (data) => resolve(data.toString().trim()));
    });
}

function formatPrice(value) {
    const n = parseFloat(value);
    if (isNaN(n)) return null;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Wraps text to a max line width for readable terminal output.
 */
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

/**
 * Loads the SDK's data graph on startup. File discovery happens here (the SDK
 * stays decoupled from the filesystem); reads and graph construction are the
 * SDK's own async load action.
 */
async function loadSdkData(config, sdk, projectRoot) {
    const basePath = config?.testData?.basePath || '';
    const refDataDir = path.resolve(path.join(projectRoot, basePath, 'RefData'));

    console.log();
    console.log('========================================');
    console.log('Loading SDK data...');
    console.log('========================================');

    const startTime = Date.now();

    // Discover the per-currency source-market files in RefData
    let sourceMarkets = [];
    try {
        sourceMarkets = fs.readdirSync(refDataDir)
            .filter((f) => /^SourceMarket_.*_seaware\.json$/.test(f))
            .sort()
            .map((f) => path.join(refDataDir, f));
    } catch (ex) {
        console.log(`  \x1b[31mCould not list source market files: ${ex.message}\x1b[0m`);
    }

    const sources = {
        voyages: path.join(refDataDir, 'voyages.json'),
        ships: path.join(refDataDir, 'ships.json'),
        cabinGrades: path.join(refDataDir, 'cabingrades.json'),
        ports: path.join(refDataDir, 'portlist.json'),
        sourceMarkets,
    };

    try {
        await sdk.load(sources, (msg) => console.log(`  ${msg}`));
    } catch (ex) {
        console.log(`  \x1b[31mFAILED to load SDK data: ${ex.message}\x1b[0m`);
    }

    const duration = Date.now() - startTime;
    if (sdk.isLoaded) {
        const s = sdk.stats;
        console.log();
        console.log(`  \x1b[36m${s.voyageCount} voyages, ${s.shipCount} ships, ${s.cabinGradeCount} cabin grades,\x1b[0m`);
        console.log(`  \x1b[36m${s.departureCount} departures, ${s.offeringCount} cabin offerings.\x1b[0m`);
        console.log(`  Done in ${duration} ms.`);
    }
    console.log();
    console.log('Press any key to continue...');
    await waitForInput();
}

function printVoyageHeader(voyage) {
    console.log();
    console.log('========================================');
    console.log(`Voyage: ${voyage.heading || '(no heading)'}`);
    console.log('========================================');
    if (voyage.durationText) console.log(`Duration: ${voyage.durationText}`);

    const description = (voyage.intro || '').trim();
    if (description) {
        console.log();
        console.log('Description:');
        for (const line of wrapText(description)) {
            console.log(`  ${line}`);
        }
    }

    const sellingPoints = (voyage.sellingPoints || []).filter((s) => s && s.trim());
    if (sellingPoints.length > 0) {
        console.log();
        console.log('Selling Points:');
        for (const point of sellingPoints) {
            const lines = wrapText(point.trim(), 72);
            console.log(`  - ${lines[0]}`);
            for (const cont of lines.slice(1)) {
                console.log(`    ${cont}`);
            }
        }
    }
}

/**
 * Formats a {currency: amount} map into wrapped, aligned price lines.
 */
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

    const pad = ' '.repeat(label.length + 1);
    return lines.map((l, i) => `${indent}${i === 0 ? `${label} ` : pad}${l}`);
}

async function selectDeparture(voyage) {
    const today = new Date().toISOString().slice(0, 10);
    const departures = voyage.upcomingDepartures(today);

    let selecting = true;
    while (selecting) {
        printHeader();
        printVoyageHeader(voyage);
        console.log();

        if (departures.length === 0) {
            console.log('No upcoming departures found for this voyage.');
            console.log();
            console.log('Press any key to go back...');
            await waitForInput();
            return;
        }

        console.log(`Departures (${departures.length}) - select one to view cabins:`);
        console.log();
        departures.forEach((d, i) => {
            const dateRange = d.endDate ? `${d.date} -> ${d.endDate}` : `${d.date}`;
            const count = d.cabinGrades.length;
            const grades = count > 0 ? `${count} cabin grade(s)` : 'no cabins/pricing';
            console.log(`  ${String(i + 1).padStart(2)}. ${dateRange}   \x1b[90m(${d.code})  [${grades}]\x1b[0m`);
        });
        console.log();
        process.stdout.write('Enter departure number (or 0 to go back): ');

        const input = await readLine();
        if (input === '0' || input === '') {
            selecting = false;
            break;
        }

        const n = parseInt(input, 10);
        if (isNaN(n) || n < 1 || n > departures.length) {
            console.log('Invalid departure number.');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
        }

        await showCabins(departures[n - 1]);
    }
}

async function showCabins(departure) {
    const voyage = departure.voyage;
    const ship = departure.ship;
    const cabins = [...departure.offerings].sort((a, b) => a.code.localeCompare(b.code));

    printHeader();
    console.log('========================================');
    console.log(`Voyage: ${voyage ? voyage.heading : '(unknown)'}`);
    const dateRange = departure.endDate ? `${departure.date} -> ${departure.endDate}` : `${departure.date}`;
    const shipLabel = ship ? `${ship.name} (${ship.id})` : departure.shipCode;
    console.log(`Departure: ${dateRange}   (${departure.code})  Ship: ${shipLabel}`);
    console.log('========================================');
    console.log();

    if (cabins.length === 0) {
        console.log('  No cabins or pricing available for this departure.');
        console.log();
        console.log('Press any key to go back...');
        await waitForInput();
        return;
    }

    console.log(`Cabins (${cabins.length}):`);
    console.log();
    cabins.forEach((cabin, i) => {
        const name = cabin.name ? `${cabin.code} - ${cabin.name}` : cabin.code;
        console.log(`  ${String(i + 1).padStart(2)}. ${name}`);

        const descs = cabin.description;
        if (descs.length > 0) {
            for (const desc of descs) {
                for (const line of wrapText(desc, 70)) {
                    console.log(`        ${line}`);
                }
            }
        } else {
            console.log('        \x1b[90m(no cabin description available)\x1b[0m');
        }

        if (cabin.availableCabins !== undefined && cabin.availableCabins !== null) {
            console.log(`        Available cabins: ${cabin.availableCabins}`);
        }

        // Build {currency: amount} maps from the offering's per-currency prices
        const dbl = {};
        const sgl = {};
        for (const p of cabin.prices) {
            if (p.double !== null) dbl[p.currency] = p.double;
            if (p.single !== null) sgl[p.currency] = p.single;
        }
        for (const l of formatPriceLines('Double (pp):', dbl, '        ')) console.log(l);
        for (const l of formatPriceLines('Single:     ', sgl, '        ')) console.log(l);
        console.log();
    });

    console.log('Press any key to go back...');
    await waitForInput();
}

async function browseDataInMemory(sdk) {
    if (!sdk || !sdk.isLoaded || sdk.voyages.length === 0) {
        console.log('No SDK data available.');
        console.log('Press any key to continue...');
        await waitForInput();
        return;
    }

    const voyages = sdk.voyages;
    const s = sdk.stats;

    let browsing = true;
    while (browsing) {
        printHeader();
        console.log('Browse Voyage Data (SDK)');
        console.log('------------------------');
        console.log(`Loaded ${s.voyageCount} voyages, ${s.shipCount} ships, ${s.departureCount} departures, ${s.offeringCount} cabin offerings.`);
        console.log();
        voyages.forEach((v, i) => {
            console.log(`  ${String(i + 1).padStart(3)}. ${v.heading || '(no heading)'}`);
        });
        console.log();
        process.stdout.write('Enter voyage number (or 0 to go back): ');

        const input = await readLine();
        if (input === '0' || input === '') {
            browsing = false;
            break;
        }

        const n = parseInt(input, 10);
        if (isNaN(n) || n < 1 || n > voyages.length) {
            console.log('Invalid voyage number.');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
        }

        await selectDeparture(voyages[n - 1]);
    }
}

async function main() {
    try {
        const projectRoot = getProjectRoot();
        const config = loadConfig();
        /** @type {IApiSdk} */
        const sdk = createApiSdk();
        
        // Initialize selected test suite from config
        let selectedSuite = config?.testData;

        let running = true;

        // Set up stdin for reading
        process.stdin.setEncoding('utf8');
        process.stdin.resume();

        // Load the SDK's data graph on startup
        await loadSdkData(config, sdk, projectRoot);

        while (running) {
            printHeader();
            printMenu(selectedSuite);

            const input = await new Promise((resolve) => {
                process.stdin.once('data', (data) => {
                    resolve(data.toString().trim());
                });
            });

            switch (input) {
                case '0':
                    showConfiguration(config, selectedSuite);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '1':
                    await runAllTests(config, sdk);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '2':
                    specifyTestSuite(selectedSuite);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '3':
                    await browseDataInMemory(sdk);
                    break;

                case '4':
                    running = false;
                    console.log('Exiting...');
                    process.exit(0);
                    break;

                default:
                    console.log('Invalid command. Please try again.');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    break;
            }
        }
    } catch (ex) {
        console.error(`\x1b[31mFATAL ERROR: ${ex.message}\x1b[0m`);
        console.error(ex.stack);
        process.exit(1);
    }
}

main();

