import { IFlatFileReader } from './interfaces/IFlatFileReader';
export declare class ApiSdk {
    private readonly _fileReader;
    constructor(fileReader?: IFlatFileReader);
    /**
     * Gets the file reader instance
     */
    get fileReader(): IFlatFileReader;
}
