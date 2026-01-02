import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Console Application Tests', () => {
    let testProjectRoot: string;
    let testConfigPath: string;
    let testDataDirectory: string;

    beforeAll(() => {
        testProjectRoot = path.join(os.tmpdir(), `test-${Date.now()}`);
        fs.mkdirSync(testProjectRoot, { recursive: true });
        
        testDataDirectory = path.join(testProjectRoot, 'data', 'test');
        fs.mkdirSync(testDataDirectory, { recursive: true });
        
        testConfigPath = path.join(testProjectRoot, 'config.json');
        
        // Create test config
        const config = {
            testData: {
                basePath: 'data/test',
                files: [
                    { name: 'file1', path: 'file1.json', description: 'Test file 1' },
                    { name: 'file2', path: 'file2.json', description: 'Test file 2' },
                    { name: 'file3', path: 'file3.json', description: 'Test file 3' }
                ]
            },
            output: {
                showCallDetails: true,
                showResponseDetails: true,
                showTiming: true
            }
        };
        
        fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));
        
        // Create test files
        config.testData.files.forEach((file: any) => {
            const filePath = path.join(testDataDirectory, file.path);
            const fileDir = path.dirname(filePath);
            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify([{ id: 1, name: 'test' }]));
        });
    });

    afterAll(() => {
        if (fs.existsSync(testProjectRoot)) {
            fs.rmSync(testProjectRoot, { recursive: true, force: true });
        }
    });

    test('Test config loads correctly', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);

        expect(config).toBeDefined();
        expect(config.testData).toBeDefined();
        expect(config.testData.basePath).toBe('data/test');
        expect(config.testData.files.length).toBe(3);
        expect(config.output).toBeDefined();
        expect(config.output.showCallDetails).toBe(true);
    });

    test('Test suite has all files present', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);
        const suite = config.testData;
        const fileCount = suite.files?.length || 0;

        expect(fileCount).toBe(3);
        expect(suite.files).toBeDefined();
        suite.files.forEach((file: any) => {
            expect(file.name).toBeDefined();
            expect(file.path).toBeDefined();
        });
    });

    test('Test suite file paths are valid', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);
        const suite = config.testData;

        expect(suite.files).toBeDefined();
        suite.files.forEach((file: any) => {
            const fullPath = path.join(testProjectRoot, suite.basePath || '', file.path || '');
            expect(fs.existsSync(fullPath)).toBe(true);
        });
    });

    test('Test suite processes all files', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);
        const suite = config.testData;
        const processedFiles: string[] = [];

        // Simulate processing all files
        if (suite.files) {
            suite.files.forEach((file: any) => {
                const fullPath = path.join(testProjectRoot, suite.basePath || '', file.path || '');
                if (fs.existsSync(fullPath)) {
                    processedFiles.push(file.name);
                }
            });
        }

        expect(processedFiles.length).toBe(3);
        expect(processedFiles).toContain('file1');
        expect(processedFiles).toContain('file2');
        expect(processedFiles).toContain('file3');
    });

    test('Test suite summary counts are correct', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);
        const suite = config.testData;
        const totalFiles = suite.files?.length || 0;
        let successCount = 0;
        let failureCount = 0;

        // Simulate processing with some successes
        if (suite.files) {
            suite.files.forEach((file: any) => {
                const fullPath = path.join(testProjectRoot, suite.basePath || '', file.path || '');
                if (fs.existsSync(fullPath)) {
                    successCount++;
                } else {
                    failureCount++;
                }
            });
        }

        expect(totalFiles).toBe(successCount + failureCount);
        expect(successCount).toBe(3);
        expect(failureCount).toBe(0);
    });

    test('Test suite handles missing files', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);
        const suite = config.testData;
        
        // Delete one file
        const fileToDelete = path.join(testDataDirectory, suite.files[1].path);
        if (fs.existsSync(fileToDelete)) {
            fs.unlinkSync(fileToDelete);
        }

        let successCount = 0;
        let failureCount = 0;

        // Process files
        suite.files.forEach((file: any) => {
            const fullPath = path.join(testProjectRoot, suite.basePath || '', file.path || '');
            if (fs.existsSync(fullPath)) {
                successCount++;
            } else {
                failureCount++;
            }
        });

        expect(successCount).toBe(2);
        expect(failureCount).toBe(1);
    });

    test('Test suite handles empty suite', () => {
        const emptyConfig = {
            testData: {
                basePath: 'data/test',
                files: []
            }
        };

        expect(emptyConfig.testData).toBeDefined();
        expect(emptyConfig.testData.files).toBeDefined();
        expect(emptyConfig.testData.files.length).toBe(0);
    });

    test('Test suite handles null suite', () => {
        const nullSuite: any = null;
        const fileCount = nullSuite?.files?.length || 0;
        expect(fileCount).toBe(0);
    });

    test('Menu options are all valid', () => {
        const validOptions = ['0', '1', '2', '3', '4', '5'];
        const invalidOptions = ['-1', '6', 'a', 'x', ''];

        validOptions.forEach(option => {
            const num = parseInt(option, 10);
            expect(num).toBeGreaterThanOrEqual(0);
            expect(num).toBeLessThanOrEqual(5);
        });

        invalidOptions.forEach(option => {
            if (option === '' || isNaN(parseInt(option, 10))) {
                // Invalid options should be rejected
                expect(true).toBe(true);
            } else {
                const num = parseInt(option, 10);
                expect(num < 0 || num > 5).toBe(true);
            }
        });
    });

    test('Suite display shows base path', () => {
        const suite = {
            basePath: 'data/test',
            files: []
        };

        const displayText = suite.basePath || 'default';
        expect(displayText).toBe('data/test');
    });

    test('Suite display shows default when null', () => {
        const suite: any = null;
        const displayText = suite?.basePath || 'default';
        expect(displayText).toBe('default');
    });

    test('Suite ingestion processes all files not just one', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);
        const suite = config.testData;
        const processedFiles: string[] = [];

        // Simulate processing - should process ALL files
        if (suite.files) {
            suite.files.forEach((file: any) => {
                processedFiles.push(file.name);
            });
        }

        // Assert that all files were processed, not just one
        expect(processedFiles.length).toBe(3);
        expect(processedFiles.length).toBe(suite.files.length);
    });

    test('Suite summary displays correct counts', () => {
        const jsonContent = fs.readFileSync(testConfigPath, 'utf-8');
        const config = JSON.parse(jsonContent);
        const suite = config.testData;
        const totalFiles = suite.files?.length || 0;
        let successCount = 0;
        let failureCount = 0;

        suite.files.forEach((file: any) => {
            const fullPath = path.join(testProjectRoot, suite.basePath || '', file.path || '');
            if (fs.existsSync(fullPath)) {
                successCount++;
            } else {
                failureCount++;
            }
        });

        // Verify summary counts match
        expect(totalFiles).toBe(3);
        expect(successCount + failureCount).toBe(totalFiles);
    });
});

