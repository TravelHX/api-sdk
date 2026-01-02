"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiSdk = void 0;
const FlatFileReader_1 = require("./FlatFileReader");
class ApiSdk {
    constructor(fileReader) {
        this._fileReader = fileReader || new FlatFileReader_1.FlatFileReader();
    }
    /**
     * Gets the file reader instance
     */
    get fileReader() {
        return this._fileReader;
    }
}
exports.ApiSdk = ApiSdk;
