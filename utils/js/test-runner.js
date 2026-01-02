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
    console.log();
    process.stdout.write('Enter command (0-5): ');
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
            await runTestFile(fileConfig, config, sdk);
            passed++;
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

