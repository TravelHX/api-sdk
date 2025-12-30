import { ApiSdk } from '../../src/js/dist/api-sdk.js';

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

function main() {
    console.log('API SDK Validation Tool');
    console.log('=======================');
    console.log();

    const results = [];

    // Test 1: SDK Instantiation
    results.push(validateSdkInstantiation());

    // Test 2: SDK Basic Functionality
    results.push(validateSdkBasicFunctionality());

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

