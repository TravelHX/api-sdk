/**
 * Base error class for file reading operations
 */
export declare class FileReadingError extends Error {
    readonly filePath?: string | undefined;
    constructor(message: string, filePath?: string | undefined);
}
/**
 * Error thrown when a file path is invalid
 */
export declare class InvalidFilePathError extends FileReadingError {
    constructor(filePath: string);
}
/**
 * Error thrown when a file is not found
 */
export declare class FileNotFoundError extends FileReadingError {
    constructor(filePath: string);
}
/**
 * Error thrown when file reading fails
 */
export declare class FileReadError extends FileReadingError {
    readonly cause?: Error;
    constructor(filePath: string, cause?: Error);
}
/**
 * Error thrown when JSON parsing fails
 */
export declare class JsonParseError extends FileReadingError {
    readonly cause?: Error;
    constructor(filePath: string, cause?: Error);
}
