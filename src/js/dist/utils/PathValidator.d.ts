/**
 * Utility functions for validating file paths
 */
export declare class PathValidator {
    /**
     * Validates that the provided file path is valid
     * @param filePath The file path to validate
     * @returns True if the path is valid, false otherwise
     */
    static isValidPath(filePath: string | null | undefined): boolean;
    /**
     * Validates the file path and throws an error if invalid
     * @param filePath The file path to validate
     * @throws {InvalidFilePathError} When the file path is invalid
     */
    static validatePathOrThrow(filePath: string | null | undefined): void;
    /**
     * Checks if a file exists at the specified path
     * @param filePath The file path to check
     * @returns True if the file exists, false otherwise
     */
    static fileExists(filePath: string): boolean;
}
