# API SDK

A cross-platform SDK that abstracts access to flat file storage (a series of JSON
files) and, in future, an OTA API. Distributed as a NuGet package for .NET and an
npm package (`@api-sdk/js`) for JavaScript/TypeScript.

The JavaScript SDK loads the flat files once into an OOP, bidirectionally-navigable
graph of voyages, ships, cabin grades, departures, ports and priced cabin offerings.

## JavaScript SDK (`@api-sdk/js`)

- **Dormant until loaded** — `createApiSdk()` returns an `IApiSdk`; nothing is read
  until `await sdk.load(sources)`.
- **Interface-only** — the package exports the `createApiSdk` factory, the interfaces
  and the entity *types*; concrete classes are hidden. All file access goes through
  `IFlatFileReader`.
- **Navigable both ways** — `voyage.departures[0].ship.cabinGrades` and
  `cabinGrade.departures[0].voyage`; related objects are shared by identity (`===`).

```js
import { createApiSdk } from '@api-sdk/js';
const sdk = createApiSdk();
await sdk.load(sources);
sdk.departure(code).offeringForGrade('DS').priceFor('GBP').double;
```

`npm run build` (in `src/js`) compiles **and** runs the `node:test` suite — a failing
test fails the build. See [../utils/js/usageCase.js](../utils/js/usageCase.js) for ~20 worked
examples that also run as the integration test.

## SDKCLI

`utils/js/SDKCLI.js` — an interactive, zero-dependency terminal UI (arrow/vim keys,
scrollable lists + pager) that consumes the SDK through its interface. Menu:

- 0. Show configuration
- 1. Run all automated tests (runs `usageCase.js`)
- 2. Specify test file suite location / name
- 3. Browse data (voyages → departures → cabins)
- 4. Exit

> The separate **.NET** runner (`utils/dotnet/ApiSdk.TestRunner`) keeps its 0–5 menu.

## OTA API Support (planned — Phase 4)

An OTA reader/client plugs into the same graph behind the same `IApiSdk` contract,
so consumer code won't change. See [todo.md](todo.md).

## Project Structure

- `docs/` — documentation
- `src/dotnet/`, `src/js/` — the SDKs (`src/js/src/data/` = OOP entities)
- `src/dotnet/ApiSdk.Tests/` — .NET unit tests, colocated with the SDK (JS unit tests live in `src/js/src/__tests__/`)
- `utils/dotnet/` — .NET runner + usage-case suite (`ApiSdk.UsageCase`)
- `utils/js/` — `SDKCLI.js` (TUI), `usageCase.js` (examples + test), `tui.js`
- `data/`, `config.json` — sample flat files and test-data config

## Running

```bash
npm run build --prefix src/js   # build SDK + run unit tests
npm install --prefix utils/js   # link the SDK into the CLI (once)
node utils/js/SDKCLI.js         # launch the CLI (real terminal)
node utils/js/usageCase.js          # examples / integration suite
npm test                        # full verification
```
