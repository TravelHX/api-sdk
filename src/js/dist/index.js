"use strict";
/**
 * Public API of @api-sdk/js.
 *
 * The SDK is consumed exclusively through its interface: construct it with
 * createApiSdk() (which returns an IApiSdk) and traverse the loaded graph via
 * the read-only entity *types*. The concrete classes (ApiSdk, FlatFileReader,
 * PathValidator and the entity constructors) are intentionally NOT exported —
 * consumers depend on the contract, never the implementation, and there is no
 * way to construct the SDK except through the factory.
 */
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiSdk = void 0;
// The only entry point — returns the SDK behind its IApiSdk interface.
var api_sdk_1 = require("./api-sdk");
Object.defineProperty(exports, "createApiSdk", { enumerable: true, get: function () { return api_sdk_1.createApiSdk; } });
// Error contract thrown by the interface's read actions (for catch handling).
__exportStar(require("./errors/FileReadingErrors"), exports);
