"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlatFileReader = void 0;
const fs = __importStar(require("fs/promises"));
const PathValidator_1 = require("./utils/PathValidator");
const FileReadingErrors_1 = require("./errors/FileReadingErrors");
/**
 * Implementation of IFlatFileReader for reading JSON files from the file system
 */
class FlatFileReader {
    /**
     * Reads a JSON file from the specified path and returns the content as a string
     * @param filePath The path to the JSON file
     * @returns Promise resolving to the file content as a string
     * @throws {InvalidFilePathError} When the file path is invalid
     * @throws {FileNotFoundError} When the file does not exist
     * @throws {FileReadError} When an I/O error occurs
     */
    async readFile(filePath) {
        // Validate path
        PathValidator_1.PathValidator.validatePathOrThrow(filePath);
        // Check if file exists
        if (!PathValidator_1.PathValidator.fileExists(filePath)) {
            throw new FileReadingErrors_1.FileNotFoundError(filePath);
        }
        try {
            return await fs.readFile(filePath, 'utf-8');
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                throw new FileReadingErrors_1.FileNotFoundError(filePath);
            }
            else if (error.code === 'EACCES' || error.code === 'EPERM') {
                throw new FileReadingErrors_1.FileReadError(filePath, new Error('Permission denied'));
            }
            else if (error instanceof FileReadingErrors_1.FileReadingError) {
                throw error;
            }
            else {
                throw new FileReadingErrors_1.FileReadError(filePath, error);
            }
        }
    }
    /**
     * Reads a JSON file from the specified path and parses it
     * @param filePath The path to the JSON file
     * @returns Promise resolving to the parsed JSON object
     * @throws {InvalidFilePathError} When the file path is invalid
     * @throws {FileNotFoundError} When the file does not exist
     * @throws {JsonParseError} When JSON parsing fails
     */
    async readFileAsJson(filePath) {
        // Validate path
        PathValidator_1.PathValidator.validatePathOrThrow(filePath);
        // Check if file exists
        if (!PathValidator_1.PathValidator.fileExists(filePath)) {
            throw new FileReadingErrors_1.FileNotFoundError(filePath);
        }
        try {
            const jsonContent = await this.readFile(filePath);
            if (!jsonContent || jsonContent.trim().length === 0) {
                throw new FileReadingErrors_1.JsonParseError(filePath, new Error('File content is empty'));
            }
            const result = JSON.parse(jsonContent);
            return result;
        }
        catch (error) {
            if (error instanceof FileReadingErrors_1.FileReadingError) {
                throw error;
            }
            else if (error instanceof SyntaxError) {
                throw new FileReadingErrors_1.JsonParseError(filePath, error);
            }
            else {
                throw new FileReadingErrors_1.JsonParseError(filePath, error);
            }
        }
    }
    /**
     * Validates that the provided file path is valid
     * @param filePath The file path to validate
     * @returns True if the path is valid, false otherwise
     */
    validatePath(filePath) {
        return PathValidator_1.PathValidator.isValidPath(filePath);
    }
}
exports.FlatFileReader = FlatFileReader;
