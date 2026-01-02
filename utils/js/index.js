import { ApiSdk } from '../../src/js/dist/api-sdk.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ValidationResult {
    constructor(testName, passed, message = '') {
        this.testName = testName;
        this.passed = passed;
        this.message = message;
    }
}

function validateSdkInstantiation() {
    try {
        const sdk = new ApiSdk();
        if (!sdk) {
            return new ValidationResult(
                'SDK Instantiation',
                false,
                'SDK instance is null'
            );
        }

        return new ValidationResult(
            'SDK Instantiation',
            true,
            'SDK created successfully'
        );
    } catch (error) {
        return new ValidationResult(
            'SDK Instantiation',
            false,
            `Exception: ${error.message}`
        );
    }
}

function validateSdkBasicFunctionality() {
    try {
        const sdk = new ApiSdk();
        
        if (!sdk) {
            return new ValidationResult(
                'SDK Basic Functionality',
                false,
                'SDK instance is null'
            );
        }

        // Validate FileReader is available
        if (!sdk.fileReader) {
            return new ValidationResult(
                'SDK Basic Functionality',
                false,
                'FileReader is null'
            );
        }

        return new ValidationResult(
            'SDK Basic Functionality',
            true,
            'SDK basic functionality validated'
        );
    } catch (error) {
        return new ValidationResult(
            'SDK Basic Functionality',
            false,
            `Exception: ${error.message}`
        );
    }
}

async function validateFileReading() {
    try {
        const sdk = new ApiSdk();
        const projectRoot = path.resolve(__dirname, '..', '..');
        const testFilePath = path.join(projectRoot, 'data', 'FlatFileSample', 'flatfiles_dev', 'RefData', 'voyages.json');

        if (!fs.existsSync(testFilePath)) {
            return new ValidationResult(
                'File Reading - Valid File',
                false,
                `Test file not found: ${testFilePath}`
            );
        }

        const content = await sdk.fileReader.readFile(testFilePath);
        
        if (!content || content.trim().length === 0) {
            return new ValidationResult(
                'File Reading - Valid File',
                false,
                'File content is empty'
            );
        }

        return new ValidationResult(
            'File Reading - Valid File',
            true,
            `Successfully read ${content.length} characters`
        );
    } catch (error) {
        return new ValidationResult(
            'File Reading - Valid File',
            false,
            `Exception: ${error.message}`
        );
    }
}

async function validateJsonDeserialization() {
    try {
        const sdk = new ApiSdk();
        const projectRoot = path.resolve(__dirname, '..', '..');
        const testFilePath = path.join(projectRoot, 'data', 'FlatFileSample', 'flatfiles_dev', 'RefData', 'voyages.json');

        if (!fs.existsSync(testFilePath)) {
            return new ValidationResult(
                'File Reading - JSON Deserialization',
                false,
                `Test file not found: ${testFilePath}`
            );
        }

        const voyages = await sdk.fileReader.readFileAsJson(testFilePath);
        
        if (!voyages || !Array.isArray(voyages) || voyages.length === 0) {
            return new ValidationResult(
                'File Reading - JSON Deserialization',
                false,
                'Deserialized data is null or empty'
            );
        }

        return new ValidationResult(
            'File Reading - JSON Deserialization',
            true,
            `Successfully deserialized ${voyages.length} items`
        );
    } catch (error) {
        return new ValidationResult(
            'File Reading - JSON Deserialization',
            false,
            `Exception: ${error.message}`
        );
    }
}

async function validateInvalidPath() {
    try {
        const sdk = new ApiSdk();
        const invalidPath = '\0invalid\0path.json';

        try {
            await sdk.fileReader.readFile(invalidPath);
            return new ValidationResult(
                'File Reading - Invalid Path',
                false,
                'Expected exception for invalid path, but none was thrown'
            );
        } catch (error) {
            if (error.name === 'InvalidFilePathError') {
                return new ValidationResult(
                    'File Reading - Invalid Path',
                    true,
                    'Correctly threw InvalidFilePathError'
                );
            } else {
                return new ValidationResult(
                    'File Reading - Invalid Path',
                    false,
                    `Unexpected exception: ${error.name} - ${error.message}`
                );
            }
        }
    } catch (error) {
        return new ValidationResult(
            'File Reading - Invalid Path',
            false,
            `Exception: ${error.message}`
        );
    }
}

async function validateFileNotFound() {
    try {
        const sdk = new ApiSdk();
        const nonExistentPath = path.join(__dirname, 'nonexistent_file.json');

        try {
            await sdk.fileReader.readFile(nonExistentPath);
            return new ValidationResult(
                'File Reading - File Not Found',
                false,
                'Expected exception for non-existent file, but none was thrown'
            );
        } catch (error) {
            if (error.name === 'FileNotFoundError') {
                return new ValidationResult(
                    'File Reading - File Not Found',
                    true,
                    'Correctly threw FileNotFoundError'
                );
            } else {
                return new ValidationResult(
                    'File Reading - File Not Found',
                    false,
                    `Unexpected exception: ${error.name} - ${error.message}`
                );
            }
        }
    } catch (error) {
        return new ValidationResult(
            'File Reading - File Not Found',
            false,
            `Exception: ${error.message}`
        );
    }
}

async function validatePathValidation() {
    try {
        const sdk = new ApiSdk();
        const projectRoot = path.resolve(__dirname, '..', '..');
        const testFilePath = path.join(projectRoot, 'data', 'FlatFileSample', 'flatfiles_dev', 'RefData', 'voyages.json');

        // Test valid path
        if (!sdk.fileReader.validatePath(testFilePath)) {
            return new ValidationResult(
                'Path Validation',
                false,
                'Valid path was rejected'
            );
        }

        // Test invalid paths
        if (sdk.fileReader.validatePath('\0invalid\0path.json')) {
            return new ValidationResult(
                'Path Validation',
                false,
                'Invalid path was accepted'
            );
        }

        if (sdk.fileReader.validatePath(null)) {
            return new ValidationResult(
                'Path Validation',
                false,
                'Null path was accepted'
            );
        }

        if (sdk.fileReader.validatePath('')) {
            return new ValidationResult(
                'Path Validation',
                false,
                'Empty path was accepted'
            );
        }

        return new ValidationResult(
            'Path Validation',
            true,
            'Path validation working correctly'
        );
    } catch (error) {
        return new ValidationResult(
            'Path Validation',
            false,
            `Exception: ${error.message}`
        );
    }
}

async function main() {
    console.log('API SDK Validation Tool');
    console.log('=======================');
    console.log();

    const results = [];

    // Test 1: SDK Instantiation
    results.push(validateSdkInstantiation());

    // Test 2: SDK Basic Functionality
    results.push(validateSdkBasicFunctionality());

    // Test 3: File Reading - Valid File
    results.push(await validateFileReading());

    // Test 4: File Reading - JSON Deserialization
    results.push(await validateJsonDeserialization());

    // Test 5: File Reading - Invalid Path
    results.push(await validateInvalidPath());

    // Test 6: File Reading - File Not Found
    results.push(await validateFileNotFound());

    // Test 7: Path Validation
    results.push(await validatePathValidation());

    // Print Results
    console.log();
    console.log('Validation Results:');
    console.log('-------------------');
    
    results.forEach(result => {
        const status = result.passed ? 'PASS' : 'FAIL';
        const statusSymbol = result.passed ? '\u2713' : '\u2717';
        console.log(`[${status}] ${result.testName} ${statusSymbol}`);
        if (result.message) {
            console.log(`  ${result.message}`);
        }
    });

    console.log();
    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;
    console.log(`Summary: ${passedCount}/${totalCount} tests passed`);

    process.exit(passedCount === totalCount ? 0 : 1);
}

main();

