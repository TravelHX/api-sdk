import { IFlatFileReader } from './interfaces/IFlatFileReader';
import { FlatFileReader } from './FlatFileReader';

export class ApiSdk {
  private readonly _fileReader: IFlatFileReader;

  constructor(fileReader?: IFlatFileReader) {
    this._fileReader = fileReader || new FlatFileReader();
  }

  /**
   * Gets the file reader instance
   */
  get fileReader(): IFlatFileReader {
    return this._fileReader;
  }
}

