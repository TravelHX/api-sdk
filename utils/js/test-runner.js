import { ApiSdk } from '../../src/js/dist/api-sdk.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

function printMenu() {
    console.log('Available Commands:');
    console.log('  1 - Run all tests');
    console.log('  2 - Run specific test file');
    console.log('  3 - List available test files');
    console.log('  4 - Show configuration');
    console.log('  5 - Exit');
    console.log();
    process.stdout.write('Enter command (1-5): ');
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

function showConfiguration(config) {
    console.log();
    console.log('Current Configuration:');
    console.log('---------------------');
    console.log(`Base Path: ${config?.testData?.basePath}`);
    console.log(`Show Call Details: ${config?.output?.showCallDetails ?? true}`);
    console.log(`Show Response Details: ${config?.output?.showResponseDetails ?? true}`);
    console.log(`Show Timing: ${config?.output?.showTiming ?? true}`);
    console.log(`Number of Test Files: ${config?.testData?.files?.length ?? 0}`);
    console.log();
}

async function runTestFile(fileConfig, config, sdk) {
    if (!sdk || !config?.testData) {
        console.log('ERROR: SDK or configuration not initialized');
        return;
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
        return;
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
    }

    console.log();
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
            await runTestFile(fileConfig, config, sdk);
            passed++;
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

async function main() {
    try {
        const projectRoot = getProjectRoot();
        const config = loadConfig();
        const sdk = new ApiSdk();

        let running = true;

        // Set up stdin for reading
        process.stdin.setEncoding('utf8');
        process.stdin.resume();

        while (running) {
            printHeader();
            printMenu();

            const input = await new Promise((resolve) => {
                process.stdin.once('data', (data) => {
                    resolve(data.toString().trim());
                });
            });

            switch (input) {
                case '1':
                    await runAllTests(config, sdk);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '2':
                    await runSpecificTest(config, sdk);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '3':
                    listTestFiles(config);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '4':
                    showConfiguration(config);
                    console.log('Press any key to continue...');
                    await waitForInput();
                    break;

                case '5':
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

