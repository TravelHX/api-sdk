"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonParseError = exports.FileReadError = exports.FileNotFoundError = exports.InvalidFilePathError = exports.FileReadingError = void 0;
/**
 * Base error class for file reading operations
 */
class FileReadingError extends Error {
    constructor(message, filePath) {
        super(message);
        this.filePath = filePath;
        this.name = 'FileReadingError';
        Object.setPrototypeOf(this, FileReadingError.prototype);
    }
}
exports.FileReadingError = FileReadingError;
/**
 * Error thrown when a file path is invalid
 */
class InvalidFilePathError extends FileReadingError {
    constructor(filePath) {
        super(`Invalid file path: ${filePath}`, filePath);
        this.name = 'InvalidFilePathError';
        Object.setPrototypeOf(this, InvalidFilePathError.prototype);
    }
}
exports.InvalidFilePathError = InvalidFilePathError;
/**
 * Error thrown when a file is not found
 */
class FileNotFoundError extends FileReadingError {
    constructor(filePath) {
        super(`File not found: ${filePath}`, filePath);
        this.name = 'FileNotFoundError';
        Object.setPrototypeOf(this, FileNotFoundError.prototype);
    }
}
exports.FileNotFoundError = FileNotFoundError;
/**
 * Error thrown when file reading fails
 */
class FileReadError extends FileReadingError {
    constructor(filePath, cause) {
        super(`Failed to read file: ${filePath}${cause ? ` - ${cause.message}` : ''}`, filePath);
        this.name = 'FileReadError';
        this.cause = cause;
        Object.setPrototypeOf(this, FileReadError.prototype);
    }
}
exports.FileReadError = FileReadError;
/**
 * Error thrown when JSON parsing fails
 */
class JsonParseError extends FileReadingError {
    constructor(filePath, cause) {
        super(`Failed to parse JSON from file: ${filePath}${cause ? ` - ${cause.message}` : ''}`, filePath);
        this.name = 'JsonParseError';
        this.cause = cause;
        Object.setPrototypeOf(this, JsonParseError.prototype);
    }
}
exports.JsonParseError = JsonParseError;
