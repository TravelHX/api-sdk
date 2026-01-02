import * as fs from 'fs/promises';
import { IFlatFileReader } from './interfaces/IFlatFileReader';
import { PathValidator } from './utils/PathValidator';
import {
  FileReadingError,
  InvalidFilePathError,
  FileNotFoundError,
  FileReadError,
  JsonParseError
} from './errors/FileReadingErrors';

/**
 * Implementation of IFlatFileReader for reading JSON files from the file system
 */
export class FlatFileReader implements IFlatFileReader {
  /**
   * Reads a JSON file from the specified path and returns the content as a string
   * @param filePath The path to the JSON file
   * @returns Promise resolving to the file content as a string
   * @throws {InvalidFilePathError} When the file path is invalid
   * @throws {FileNotFoundError} When the file does not exist
   * @throws {FileReadError} When an I/O error occurs
   */
  async readFile(filePath: string): Promise<string> {
    // Validate path
    PathValidator.validatePathOrThrow(filePath);

    // Check if file exists
    if (!PathValidator.fileExists(filePath)) {
      throw new FileNotFoundError(filePath);
    }

    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(filePath);
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new FileReadError(filePath, new Error('Permission denied'));
      } else if (error instanceof FileReadingError) {
        throw error;
      } else {
        throw new FileReadError(filePath, error);
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
  async readFileAsJson<T = any>(filePath: string): Promise<T> {
    // Validate path
    PathValidator.validatePathOrThrow(filePath);

    // Check if file exists
    if (!PathValidator.fileExists(filePath)) {
      throw new FileNotFoundError(filePath);
    }

    try {
      const jsonContent = await this.readFile(filePath);

      if (!jsonContent || jsonContent.trim().length === 0) {
        throw new JsonParseError(filePath, new Error('File content is empty'));
      }

      const result = JSON.parse(jsonContent);
      return result as T;
    } catch (error: any) {
      if (error instanceof FileReadingError) {
        throw error;
      } else if (error instanceof SyntaxError) {
        throw new JsonParseError(filePath, error);
      } else {
        throw new JsonParseError(filePath, error);
      }
    }
  }

  /**
   * Validates that the provided file path is valid
   * @param filePath The file path to validate
   * @returns True if the path is valid, false otherwise
   */
  validatePath(filePath: string): boolean {
    return PathValidator.isValidPath(filePath);
  }
}

