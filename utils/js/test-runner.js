import { ApiSdk } from '../../src/js/dist/api-sdk.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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
    console.log('API SDK Interactive Test Runner');
    console.log('========================================');
    console.log();
}

function printMenu(selectedSuite) {
    console.log('Available Commands:');
    console.log('  0 - Show configuration');
    console.log('  1 - Run All Automated Tests');
    const suiteDisplay = selectedSuite ? ` (${selectedSuite.basePath || 'default'})` : '';
    console.log(`  2 - Specify Test File Suite Location / name${suiteDisplay}`);
    console.log('  3 - Run .Net SDK against flat file suite');
    console.log('  4 - Run NodeJS SDK against flat file suite');
    console.log('  5 - Exit');
    console.log('  6 - Browse Voyage Data (in-memory)');
    console.log();
    process.stdout.write('Enter command (0-6): ');
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
        const content = await sdk.fileReader.readFile(resolvedPath);
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

async function runSpecificTest(config, sdk) {
    listTestFiles(config);
    process.stdout.write('Enter test file number: ');

    return new Promise((resolve) => {
        process.stdin.once('data', async (data) => {
            const input = data.toString().trim();
            const fileNumber = parseInt(input, 10);

            if (isNaN(fileNumber) || fileNumber < 1) {
                console.log('Invalid file number.');
                resolve();
                return;
            }

            if (!config?.testData?.files || fileNumber > config.testData.files.length) {
                console.log('Invalid file number.');
                resolve();
                return;
            }

            const fileConfig = config.testData.files[fileNumber - 1];
            await runTestFile(fileConfig, config, sdk);
            resolve();
        });
    });
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

async function runDotNetSdkSuite(selectedSuite, config) {
    const suite = selectedSuite || config?.testData;
    if (!suite || !suite.files || suite.files.length === 0) {
        console.log('No test suite configured.');
        return;
    }

    console.log();
    console.log('========================================');
    console.log('Running .NET SDK against Flat File Suite');
    console.log('========================================');
    console.log(`Suite Base Path: ${suite.basePath}`);
    console.log(`Total Files: ${suite.files.length}`);
    console.log();
    console.log('Launching .NET test runner in a new window...');
    console.log('Please select option 3 from the .NET menu to run the suite.');
    console.log();

    // Find the .NET test runner executable
    const projectRoot = getProjectRoot();
    const dotnetRunnerPath = path.join(projectRoot, 'utils', 'dotnet', 'ApiSdk.TestRunner', 'bin', 'Debug', 'net9.0', 'ApiSdk.TestRunner.dll');
    
    if (!fs.existsSync(dotnetRunnerPath)) {
        console.error('\x1b[31mERROR: .NET test runner not found at: ' + dotnetRunnerPath + '\x1b[0m');
        return;
    }

    try {
        return new Promise((resolve) => {
            let dotnetProcess;
            const isWindows = process.platform === 'win32';

            if (isWindows) {
                // Windows: Use cmd.exe /c start to open in new window
                const cmd = `cmd.exe`;
                const args = ['/c', 'start', '"NET Test Runner"', '/D', `"${projectRoot}"`, 'dotnet', `"${dotnetRunnerPath}"`];
                dotnetProcess = spawn(cmd, args, {
                    cwd: projectRoot,
                    detached: false,
                    shell: false
                });
            } else {
                // Unix-like systems: Use xterm, gnome-terminal, or similar
                const terminal = process.env.TERM_PROGRAM || 'xterm';
                let cmd, args;

                if (terminal.includes('gnome') || fs.existsSync('/usr/bin/gnome-terminal')) {
                    cmd = 'gnome-terminal';
                    args = ['--', 'bash', '-c', `cd '${projectRoot}' && dotnet '${dotnetRunnerPath}'; exec bash`];
                } else if (fs.existsSync('/usr/bin/xterm')) {
                    cmd = 'xterm';
                    args = ['-e', 'bash', '-c', `cd '${projectRoot}' && dotnet '${dotnetRunnerPath}'; exec bash`];
                } else {
                    // Fallback: try to use the default terminal
                    cmd = 'dotnet';
                    args = [dotnetRunnerPath];
                }

                dotnetProcess = spawn(cmd, args, {
                    cwd: projectRoot,
                    detached: true,
                    stdio: 'ignore',
                    shell: false
                });
            }

            dotnetProcess.on('error', (err) => {
                console.error(`\x1b[31mERROR: Failed to execute .NET test runner: ${err.message}\x1b[0m`);
                console.log();
                resolve();
            });

            // For Windows, wait a moment to see if process starts successfully
            // For Unix, detached processes don't emit 'close' event
            if (isWindows) {
                setTimeout(() => {
                    console.log('\x1b[32m.NET test runner launched in a new window.\x1b[0m');
                    console.log();
                    resolve();
                }, 500);
            } else {
                // Unref to allow Node.js to exit if this is the only thing keeping it alive
                dotnetProcess.unref();
                console.log('\x1b[32m.NET test runner launched in a new window.\x1b[0m');
                console.log();
                resolve();
            }
        });
    } catch (ex) {
        console.error(`\x1b[31mERROR: Failed to execute .NET test runner: ${ex.message}\x1b[0m`);
        console.error(ex.stack);
        console.log();
    }
}

async function runNodeJsSdkSuite(selectedSuite, config, sdk) {
    const suite = selectedSuite || config?.testData;
    if (!suite || !suite.files || suite.files.length === 0) {
        console.log('No test suite configured.');
        return;
    }

    console.log();
    console.log('========================================');
    console.log('Running NodeJS SDK against Flat File Suite');
    console.log('========================================');
    console.log(`Suite Base Path: ${suite.basePath}`);
    console.log(`Total Files: ${suite.files.length}`);
    console.log();

    const totalStartTime = Date.now();
    let passed = 0;
    let failed = 0;

    for (const fileConfig of suite.files) {
        try {
            const ok = await runTestFile(fileConfig, config, sdk);
            if (ok) passed++; else failed++;
        } catch (ex) {
            console.error(`\x1b[31mFailed to process file ${fileConfig.name}: ${ex.message}\x1b[0m`);
            failed++;
        }
    }

    const totalDuration = Date.now() - totalStartTime;

    console.log('========================================');
    console.log('Suite Ingestion Summary');
    console.log('========================================');
    console.log(`Total Files: ${suite.files.length}`);
    console.log(`\x1b[32mSuccess: ${passed}\x1b[0m`);
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
    console.log(`Total Duration: ${totalDuration} ms`);
    console.log();
}

// ---------------------------------------------------------------------------
// Option 6: in-memory voyage browsing
// ---------------------------------------------------------------------------

/**
 * Reads a single line of input from stdin.
 */
function readLine() {
    return new Promise((resolve) => {
        process.stdin.once('data', (data) => resolve(data.toString().trim()));
    });
}

/**
 * Source-market TourCodes are prefixed with "_@" before the actual code,
 * e.g. "_@SCGALE-280209". Voyage travelSuggestionCodes have no such prefix.
 */
function stripTourCode(tourCode) {
    return (tourCode || '').replace(/^_@/, '');
}

/**
 * travelSuggestionCodes / TourCodes end in a YYMMDD departure stamp,
 * e.g. "SCGALEMAC-260403" -> 2026-04-03. Used as a fallback date when a
 * code has no matching source-market rows.
 */
function parseDepartureDateFromCode(code) {
    const m = /-(\d{6})$/.exec(code || '');
    if (!m) return null;
    return `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`;
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
 * Loads voyages and every source-market rate file into memory on startup,
 * indexing rate rows by their (stripped) TourCode so they can be mapped back
 * to a voyage's travelSuggestionCodes.
 */
async function loadInMemoryData(config, sdk, projectRoot) {
    const basePath = config?.testData?.basePath || '';
    const refDataDir = path.resolve(path.join(projectRoot, basePath, 'RefData'));

    console.log();
    console.log('========================================');
    console.log('Loading in-memory data...');
    console.log('========================================');

    const startTime = Date.now();
    const memory = { voyages: [], rateMap: {}, stats: {} };

    // 1. Load voyages
    process.stdout.write('  Loading voyages... ');
    try {
        memory.voyages = await sdk.fileReader.readFileAsJson(path.join(refDataDir, 'voyages.json'));
        console.log(`\x1b[32m${memory.voyages.length} voyages\x1b[0m`);
    } catch (ex) {
        console.log(`\x1b[31mFAILED: ${ex.message}\x1b[0m`);
        memory.voyages = [];
    }

    // 1b. Load cabin grade descriptions, indexed by grade code (= source-market Category).
    // Descriptions vary per ship; the ship is the first two letters of the tour code.
    process.stdout.write('  Loading cabin grades... ');
    memory.cabinGrades = {};
    try {
        const grades = await sdk.fileReader.readFileAsJson(path.join(refDataDir, 'cabingrades.json'));
        for (const g of grades) {
            if (!g.code) continue;
            const byShip = {};
            for (const sd of (g.shipDescriptions || [])) {
                const ship = (sd.shipCode || '').trim();
                const d = (sd.description || '').trim();
                if (!d) continue;
                if (!byShip[ship]) byShip[ship] = [];
                if (!byShip[ship].includes(d)) byShip[ship].push(d);
            }
            memory.cabinGrades[g.code] = byShip;
        }
        console.log(`\x1b[32m${Object.keys(memory.cabinGrades).length} grades\x1b[0m`);
    } catch (ex) {
        console.log(`\x1b[31mFAILED: ${ex.message}\x1b[0m`);
    }

    // 2. Discover and index every source-market rate file by TourCode
    let rateFiles = [];
    try {
        rateFiles = fs.readdirSync(refDataDir)
            .filter((f) => /^SourceMarket_.*_seaware\.json$/.test(f))
            .sort();
    } catch (ex) {
        console.log(`  \x1b[31mCould not list source market files: ${ex.message}\x1b[0m`);
    }

    console.log(`  Mapping ${rateFiles.length} source market file(s) by TourCode...`);
    let totalRows = 0;
    for (let i = 0; i < rateFiles.length; i++) {
        const file = rateFiles[i];
        process.stdout.write(`    [${i + 1}/${rateFiles.length}] ${file} ... `);
        try {
            const rows = await sdk.fileReader.readFileAsJson(path.join(refDataDir, file));
            let count = 0;
            for (const row of rows) {
                const code = stripTourCode(row.TourCode);
                if (!code) continue;
                if (!memory.rateMap[code]) memory.rateMap[code] = [];
                memory.rateMap[code].push(row);
                count++;
            }
            totalRows += count;
            console.log(`\x1b[32m${count} rates\x1b[0m`);
        } catch (ex) {
            console.log(`\x1b[31mFAILED: ${ex.message}\x1b[0m`);
        }
    }

    const duration = Date.now() - startTime;
    memory.stats = {
        voyageCount: memory.voyages.length,
        tourCodeCount: Object.keys(memory.rateMap).length,
        rateRowCount: totalRows,
        durationMs: duration,
    };

    console.log();
    console.log(`  \x1b[36mIndexed ${memory.stats.tourCodeCount} tour codes from ${totalRows} rate rows.\x1b[0m`);
    console.log(`  Done in ${duration} ms.`);
    console.log();
    console.log('Press any key to continue...');
    await waitForInput();

    return memory;
}

/**
 * For a voyage, resolves each travelSuggestionCode to its source-market rows
 * and summarizes departures (date range + cheapest double rate per currency).
 */
function buildVoyageDepartures(voyage, rateMap) {
    const codes = voyage.travelSuggestionCodes || [];
    const departures = codes.map((code) => {
        const rows = rateMap[code] || [];
        const startDate = rows.length ? rows[0].TourStartDate : parseDepartureDateFromCode(code);
        const endDate = rows.length ? rows[0].TourEndDate : null;

        // cheapest double-occupancy rate per currency
        const byCurrency = {};
        for (const r of rows) {
            const cur = r.Currency || '?';
            const price = parseFloat(r.Rate_Dbl);
            if (isNaN(price)) continue;
            if (byCurrency[cur] === undefined || price < byCurrency[cur]) {
                byCurrency[cur] = price;
            }
        }
        const cabinCount = new Set(rows.map((r) => r.Category).filter(Boolean)).size;
        return { code, startDate, endDate, rateCount: rows.length, cabinCount, byCurrency };
    });

    // Filter out departures that have already passed (date before today).
    // Departures with no parseable date are kept so nothing is silently dropped.
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = departures.filter((d) => !d.startDate || d.startDate >= today);

    upcoming.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    return upcoming;
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

/**
 * Resolves the cabin-grade description for a grade code on a given ship
 * (ship = first two letters of the tour code). Falls back to any ship's
 * description if the exact ship isn't found.
 */
function resolveCabinDescriptions(memory, gradeCode, shipCode) {
    const byShip = memory.cabinGrades?.[gradeCode];
    if (!byShip) return [];
    if (shipCode && byShip[shipCode] && byShip[shipCode].length) return byShip[shipCode];
    // fallback: distinct descriptions across all ships
    const all = [];
    for (const descs of Object.values(byShip)) {
        for (const d of descs) if (!all.includes(d)) all.push(d);
    }
    return all;
}

async function selectDeparture(voyage, memory) {
    const departures = buildVoyageDepartures(voyage, memory.rateMap);

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
            const dateRange = d.endDate ? `${d.startDate} -> ${d.endDate}` : `${d.startDate}`;
            const grades = d.cabinCount > 0 ? `${d.cabinCount} cabin grade(s)` : 'no cabins/pricing';
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

        await showCabins(voyage, departures[n - 1], memory);
    }
}

async function showCabins(voyage, departure, memory) {
    const rows = memory.rateMap[departure.code] || [];
    const shipCode = (departure.code || '').slice(0, 2);

    // group rows by cabin Category (one row per currency per cabin)
    const byCategory = {};
    for (const r of rows) {
        const cat = r.Category || '?';
        if (!byCategory[cat]) {
            byCategory[cat] = {
                category: cat,
                superCategory: r.SuperCategory || '',
                available: r.AvailableCabins,
                dbl: {},
                sgl: {},
            };
        }
        const entry = byCategory[cat];
        const cur = r.Currency || '?';
        const dbl = parseFloat(r.Rate_Dbl);
        const sgl = parseFloat(r.Rate_Sgl);
        if (!isNaN(dbl)) entry.dbl[cur] = dbl;
        if (!isNaN(sgl)) entry.sgl[cur] = sgl;
    }

    const cabins = Object.values(byCategory).sort((a, b) => a.category.localeCompare(b.category));

    printHeader();
    console.log('========================================');
    console.log(`Voyage: ${voyage.heading || '(no heading)'}`);
    const dateRange = departure.endDate ? `${departure.startDate} -> ${departure.endDate}` : `${departure.startDate}`;
    console.log(`Departure: ${dateRange}   (${departure.code})  Ship: ${shipCode}`);
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
        const name = cabin.superCategory ? `${cabin.category} - ${cabin.superCategory}` : cabin.category;
        console.log(`  ${String(i + 1).padStart(2)}. ${name}`);

        const descs = resolveCabinDescriptions(memory, cabin.category, shipCode);
        if (descs.length > 0) {
            for (const desc of descs) {
                for (const line of wrapText(desc, 70)) {
                    console.log(`        ${line}`);
                }
            }
        } else {
            console.log('        \x1b[90m(no cabin description available)\x1b[0m');
        }

        if (cabin.available !== undefined && cabin.available !== null) {
            console.log(`        Available cabins: ${cabin.available}`);
        }
        for (const l of formatPriceLines('Double (pp):', cabin.dbl, '        ')) console.log(l);
        for (const l of formatPriceLines('Single:     ', cabin.sgl, '        ')) console.log(l);
        console.log();
    });

    console.log('Press any key to go back...');
    await waitForInput();
}

async function browseDataInMemory(memory) {
    if (!memory || !memory.voyages || memory.voyages.length === 0) {
        console.log('No in-memory voyage data available.');
        console.log('Press any key to continue...');
        await waitForInput();
        return;
    }

    let browsing = true;
    while (browsing) {
        printHeader();
        console.log('Browse Voyage Data (in-memory)');
        console.log('------------------------------');
        console.log(`Loaded ${memory.stats.voyageCount} voyages, ${memory.stats.tourCodeCount} tour codes, ${memory.stats.rateRowCount} rate rows.`);
        console.log();
        memory.voyages.forEach((v, i) => {
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
        if (isNaN(n) || n < 1 || n > memory.voyages.length) {
            console.log('Invalid voyage number.');
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
        }

        await selectDeparture(memory.voyages[n - 1], memory);
    }
}

async function main() {
    try {
        const projectRoot = getProjectRoot();
        const config = loadConfig();
        const sdk = new ApiSdk();
        
        // Initialize selected test suite from config
        let selectedSuite = config?.testData;

        let running = true;

        // Set up stdin for reading
        process.stdin.setEncoding('utf8');
        process.stdin.resume();

        // Load and index data into memory on startup (voyages <-> source market)
        const memory = await loadInMemoryData(config, sdk, projectRoot);

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
                    await runDotNetSdkSuite(selectedSuite, config);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '4':
                    await runNodeJsSdkSuite(selectedSuite, config, sdk);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '5':
                    running = false;
                    console.log('Exiting...');
                    process.exit(0);
                    break;

                case '6':
                    await browseDataInMemory(memory);
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

