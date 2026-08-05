# API SDK

A cross-platform SDK that abstracts access to flat file storage (a series of JSON
files) and, in future, an OTA API. Distributed as a NuGet package for .NET and an
npm package (`@api-sdk/js`) for JavaScript/TypeScript.

The JavaScript SDK loads the flat files once into an OOP, bidirectionally-navigable
graph of voyages, ships, cabin grades, departures, ports and priced cabin offerings.

## SDKs (`@api-sdk/js` · `ApiSdk` NuGet)

Both SDKs expose the **same contract** (`IApiSdk`) and behave identically — pick the
factory, `load`, then traverse the graph. The JS and .NET surfaces mirror each other
method-for-method.

- **Dormant until loaded** — the factory returns an `IApiSdk`; nothing is read until
  you load sources (`sdk.load` / `sdk.LoadAsync`).
- **Interface-only** — packages export the factory, the interfaces and the entity
  *types*; concrete classes are hidden. All file access goes through a flat-file
  reader interface (`IFlatFileReader`).
- **Navigable both ways** — `voyage.departures[0].ship.cabinGrades` and
  `cabinGrade.departures[0].voyage`; related objects are shared by identity.

**JavaScript:**
```js
import { createApiSdk } from '@api-sdk/js';
const sdk = createApiSdk();
await sdk.load(sources);
sdk.departure(code).offeringForGrade('DS').priceFor('GBP').double;
```

**.NET:**
```csharp
using ApiSdk;
var sdk = ApiSdkFactory.CreateApiSdk();
await sdk.LoadAsync(sources);
sdk.GetDeparture(code).OfferingForGrade("DS").PriceFor("GBP").Double;
```

Tests run as part of each build: `npm run build` (in `src/js`) compiles **and** runs
the `node:test` suite; `dotnet test` runs the xUnit suite. A failing test fails the
build. See [../utils/js/usageCase.js](../utils/js/usageCase.js) and
`utils/dotnet/ApiSdk.UsageCase` for ~20 worked examples that double as the integration
tests on each side.

## SDKCLI

An interactive, zero-dependency terminal UI (arrow/vim keys, scrollable lists +
pager) that consumes the SDK through its interface. Two implementations sharing
the same chrome, but their menus have diverged — the .NET CLI gained an
interactive market/locale setup flow (and a matching "reload" menu item) that
the JS CLI doesn't have yet:

- `utils/js/SDKCLI.js` — JavaScript (`tui.js` primitives)
- `utils/dotnet/ApiSdk.SDKCLI` — .NET, a faithful TUI port (`Tui.cs`)

**JS menu** (`utils/js/SDKCLI.js`):

- 0. Show configuration
- 1. Run all automated tests
- 2. Specify test file suite location / name
- 3. Browse data (voyages → departures → cabins)
- 4. Exit

**.NET menu** (`utils/dotnet/ApiSdk.SDKCLI`):

- 0. Reload data (re-run the format/market/locale setup flow and reload the SDK graph)
- 1. Show configuration
- 2. Run all automated tests
- 3. Specify test file suite location / name
- 4. Browse data (voyages → departures → cabins)
- 5. Exit

The .NET CLI also prompts interactively for data-source format, market and
locale at startup — or reads them from the `DATASOURCE_FORMAT`,
`DATASOURCE_MARKET` and `DATASOURCE_LOCALE` environment variables as a
non-interactive shortcut when all three are validly set. A cancelled or failed
setup/load doesn't dead-end the session: menu item 0 re-enters the same flow.

Each CLI runs its own suite in-process and stays isolated — neither launches the
other. Launch either with `./run-cli.sh` (see **Running**).

## OTA API Support (planned — Phase 4)

An OTA reader/client plugs into the same graph behind the same `IApiSdk` contract,
so consumer code won't change. See [todo.md](todo.md).

## Project Structure

- `docs/` — documentation
- `src/dotnet/`, `src/js/` — the SDKs (`src/js/src/data/` = OOP entities)
- `src/dotnet/ApiSdk.Tests/` — .NET unit tests, colocated with the SDK (JS unit tests live in `src/js/src/__tests__/`)
- `utils/dotnet/` — `ApiSdk.SDKCLI` (TUI) + `ApiSdk.UsageCase` (examples + integration suite)
- `utils/js/` — `SDKCLI.js` (TUI), `usageCase.js` (examples + test), `tui.js`
- `data/`, `config.json` — sample flat files and test-data config
- `Dockerfile`, `docker-compose.yml`, `run-cli.sh` — canonical build/test path + CLI launcher

## Running

Docker is the canonical, system-agnostic build/test path — CI runs the exact same
commands. The multi-stage `Dockerfile` builds both SDKs and runs both test gates
(.NET xUnit + JS `node --test`) as build-stage gates.

```bash
# Build + run both test gates (what CI does):
docker compose build                  # builds every stage; fails on any test failure
docker compose run --rm gate          # same gates, ends in /bin/true

# Usage / integration suites:
docker compose run --rm dotnet-usage  # .NET worked examples
docker compose run --rm node-usage    # JS worked examples

# Interactive CLI (full-screen TUI) — recommended launcher:
./run-cli.sh                          # prompts: 1 = .NET, 2 = JS
./run-cli.sh dotnet                   # .NET TUI  (compose service dotnet-cli)
./run-cli.sh js                       # JS TUI    (compose service node-cli)
```

`config.json` and `data/` are mounted read-only at runtime, never baked into the
images — edit them on the host and the next run picks them up.

### Local (without Docker)

Requires Node 20+ and the .NET 9 SDK installed.

```bash
npm run build --prefix src/js   # build JS SDK + run unit tests
npm install --prefix utils/js   # link the SDK into the CLI (once)
node utils/js/SDKCLI.js         # launch the JS CLI (real terminal)
node utils/js/usageCase.js      # JS examples / integration suite

dotnet test src/dotnet/ApiSdk.sln                          # .NET tests
dotnet run --project utils/dotnet/ApiSdk.SDKCLI            # launch the .NET CLI
```
