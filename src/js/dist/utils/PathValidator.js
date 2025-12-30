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
exports.PathValidator = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const FileReadingErrors_1 = require("../errors/FileReadingErrors");
/**
 * Utility functions for validating file paths
 */
class PathValidator {
    /**
     * Validates that the provided file path is valid
     * @param filePath The file path to validate
     * @returns True if the path is valid, false otherwise
     */
    static isValidPath(filePath) {
        if (!filePath || filePath.trim().length === 0) {
            return false;
        }
        // Check for null bytes
        if (filePath.includes('\0')) {
            return false;
        }
        // Check for empty path segments
        const segments = filePath.split(path.sep);
        if (segments.some(segment => segment.trim().length === 0 && segment !== '')) {
            return false;
        }
        // Check if path is too long (Windows MAX_PATH limit is 260, but we'll be more lenient)
        if (filePath.length > 4096) {
            return false;
        }
        // Try to normalize the path - if it throws, the path is invalid
        try {
            path.normalize(filePath);
        }
        catch {
            return false;
        }
        return true;
    }
    /**
     * Validates the file path and throws an error if invalid
     * @param filePath The file path to validate
     * @throws {InvalidFilePathError} When the file path is invalid
     */
    static validatePathOrThrow(filePath) {
        if (!this.isValidPath(filePath)) {
            throw new FileReadingErrors_1.InvalidFilePathError(filePath || '');
        }
    }
    /**
     * Checks if a file exists at the specified path
     * @param filePath The file path to check
     * @returns True if the file exists, false otherwise
     */
    static fileExists(filePath) {
        if (!this.isValidPath(filePath)) {
            return false;
        }
        try {
            return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
        }
        catch {
            return false;
        }
    }
}
exports.PathValidator = PathValidator;
