import * as path from 'path';
import * as fs from 'fs';
import { InvalidFilePathError } from '../errors/FileReadingErrors';

/**
 * Utility functions for validating file paths
 */
export class PathValidator {
  /**
   * Validates that the provided file path is valid
   * @param filePath The file path to validate
   * @returns True if the path is valid, false otherwise
   */
  static isValidPath(filePath: string | null | undefined): boolean {
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
    } catch {
      return false;
    }

    return true;
  }

  /**
   * Validates the file path and throws an error if invalid
   * @param filePath The file path to validate
   * @throws {InvalidFilePathError} When the file path is invalid
   */
  static validatePathOrThrow(filePath: string | null | undefined): void {
    if (!this.isValidPath(filePath)) {
      throw new InvalidFilePathError(filePath || '');
    }
  }

  /**
   * Checks if a file exists at the specified path
   * @param filePath The file path to check
   * @returns True if the file exists, false otherwise
   */
  static fileExists(filePath: string): boolean {
    if (!this.isValidPath(filePath)) {
      return false;
    }

    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }
}

