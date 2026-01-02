import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FlatFileReader } from '../../../../src/js/src/FlatFileReader';
import {
  InvalidFilePathError,
  FileNotFoundError,
  FileReadError,
  JsonParseError
} from '../../../../src/js/src/errors/FileReadingErrors';

describe('FlatFileReader', () => {
  let testDir: string;
  let reader: FlatFileReader;

  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-sdk-test-'));
    reader = new FlatFileReader();
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('readFile', () => {
    it('should read a valid file and return content', async () => {
      const filePath = path.join(testDir, 'test.json');
      const expectedContent = '{"test": "value"}';
      await fs.writeFile(filePath, expectedContent, 'utf-8');

      const result = await reader.readFile(filePath);

      expect(result).toBe(expectedContent);
    });

    it('should throw InvalidFilePathError for null path', async () => {
      await expect(reader.readFile(null as any)).rejects.toThrow(InvalidFilePathError);
    });

    it('should throw InvalidFilePathError for empty path', async () => {
      await expect(reader.readFile('')).rejects.toThrow(InvalidFilePathError);
    });

    it('should throw InvalidFilePathError for invalid path', async () => {
      await expect(reader.readFile('\0invalid\0path')).rejects.toThrow(InvalidFilePathError);
    });

    it('should throw FileNotFoundError for non-existent file', async () => {
      const filePath = path.join(testDir, 'nonexistent.json');

      await expect(reader.readFile(filePath)).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('readFileAsJson', () => {
    it('should read and parse valid JSON file', async () => {
      const filePath = path.join(testDir, 'test.json');
      const jsonContent = '{"name": "Test", "value": 123}';
      await fs.writeFile(filePath, jsonContent, 'utf-8');

      const result = await reader.readFileAsJson<{ name: string; value: number }>(filePath);

      expect(result).toBeDefined();
      expect(result.name).toBe('Test');
      expect(result.value).toBe(123);
    });

    it('should throw JsonParseError for invalid JSON', async () => {
      const filePath = path.join(testDir, 'invalid.json');
      const invalidJson = '{ invalid json }';
      await fs.writeFile(filePath, invalidJson, 'utf-8');

      await expect(reader.readFileAsJson(filePath)).rejects.toThrow(JsonParseError);
    });

    it('should throw JsonParseError for empty file', async () => {
      const filePath = path.join(testDir, 'empty.json');
      await fs.writeFile(filePath, '', 'utf-8');

      await expect(reader.readFileAsJson(filePath)).rejects.toThrow(JsonParseError);
    });

    it('should parse array JSON correctly', async () => {
      const filePath = path.join(testDir, 'array.json');
      const jsonContent = '[{"name": "Item1", "value": 1}, {"name": "Item2", "value": 2}]';
      await fs.writeFile(filePath, jsonContent, 'utf-8');

      const result = await reader.readFileAsJson<Array<{ name: string; value: number }>>(filePath);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Item1');
      expect(result[1].name).toBe('Item2');
    });

    it('should throw FileNotFoundError for non-existent file', async () => {
      const filePath = path.join(testDir, 'nonexistent.json');

      await expect(reader.readFileAsJson(filePath)).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('validatePath', () => {
    it('should return true for valid path', () => {
      const validPath = path.join(testDir, 'test.json');
      expect(reader.validatePath(validPath)).toBe(true);
    });

    it('should return false for invalid path', () => {
      expect(reader.validatePath('\0invalid\0path')).toBe(false);
    });

    it('should return false for null path', () => {
      expect(reader.validatePath(null as any)).toBe(false);
    });

    it('should return false for empty path', () => {
      expect(reader.validatePath('')).toBe(false);
    });
  });
});

