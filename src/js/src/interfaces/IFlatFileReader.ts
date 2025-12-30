/**
 * Interface for reading flat file JSON data
 */
export interface IFlatFileReader {
  /**
   * Reads a JSON file from the specified path and returns the content as a string
   * @param filePath The path to the JSON file
   * @returns Promise resolving to the file content as a string
   * @throws {InvalidFilePathError} When the file path is invalid
   * @throws {FileNotFoundError} When the file does not exist
   * @throws {FileReadError} When an I/O error occurs
   */
  readFile(filePath: string): Promise<string>;

  /**
   * Reads a JSON file from the specified path and parses it
   * @param filePath The path to the JSON file
   * @returns Promise resolving to the parsed JSON object
   * @throws {InvalidFilePathError} When the file path is invalid
   * @throws {FileNotFoundError} When the file does not exist
   * @throws {JsonParseError} When JSON parsing fails
   */
  readFileAsJson<T = any>(filePath: string): Promise<T>;

  /**
   * Validates that the provided file path is valid
   * @param filePath The file path to validate
   * @returns True if the path is valid, false otherwise
   */
  validatePath(filePath: string): boolean;
}

