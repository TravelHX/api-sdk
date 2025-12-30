/**
 * Base error class for file reading operations
 */
export class FileReadingError extends Error {
  constructor(message: string, public readonly filePath?: string) {
    super(message);
    this.name = 'FileReadingError';
    Object.setPrototypeOf(this, FileReadingError.prototype);
  }
}

/**
 * Error thrown when a file path is invalid
 */
export class InvalidFilePathError extends FileReadingError {
  constructor(filePath: string) {
    super(`Invalid file path: ${filePath}`, filePath);
    this.name = 'InvalidFilePathError';
    Object.setPrototypeOf(this, InvalidFilePathError.prototype);
  }
}

/**
 * Error thrown when a file is not found
 */
export class FileNotFoundError extends FileReadingError {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`, filePath);
    this.name = 'FileNotFoundError';
    Object.setPrototypeOf(this, FileNotFoundError.prototype);
  }
}

/**
 * Error thrown when file reading fails
 */
export class FileReadError extends FileReadingError {
  public readonly cause?: Error;

  constructor(filePath: string, cause?: Error) {
    super(`Failed to read file: ${filePath}${cause ? ` - ${cause.message}` : ''}`, filePath);
    this.name = 'FileReadError';
    this.cause = cause;
    Object.setPrototypeOf(this, FileReadError.prototype);
  }
}

/**
 * Error thrown when JSON parsing fails
 */
export class JsonParseError extends FileReadingError {
  public readonly cause?: Error;

  constructor(filePath: string, cause?: Error) {
    super(`Failed to parse JSON from file: ${filePath}${cause ? ` - ${cause.message}` : ''}`, filePath);
    this.name = 'JsonParseError';
    this.cause = cause;
    Object.setPrototypeOf(this, JsonParseError.prototype);
  }
}

