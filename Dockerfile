# syntax=docker/dockerfile:1
#
# Canonical, system-agnostic build + test path for the API SDK.
#
# One multi-stage build with named --target stages:
#   dotnet-test  : restore + build + `dotnet test` (xUnit gate) + publish the .NET usage runner
#   node-test    : npm install + `npm run build` (tsc + node --test gate) + stage the JS usage runner
#   dotnet-usage : thin .NET runtime image that runs ApiSdk.UsageCase.dll
#   node-usage   : thin Node runtime image that runs usageCase.js / SDKCLI.js
#   gate         : fan-in that forces BOTH test gates in a single `docker build`/`compose build`
#
# Test gates fail the build: `dotnet test` and `node --test` run during the
# respective *-test stages, so any failing test aborts the image build.
#
# config.json and data/ are intentionally NOT baked into the runtime images;
# they are mounted read-only via docker-compose so the images stay generic.

# =============================================================================
# Stage: dotnet-test - .NET build + xUnit gate + publish usage runner
# =============================================================================
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS dotnet-test
WORKDIR /src

# --- Restore layer: copy ONLY project/solution metadata first so the (slow)
#     restore is cached and only re-runs when a csproj/sln changes. -----------
# SDK solution (ApiSdk + ApiSdk.Tests)
COPY src/dotnet/ApiSdk.sln src/dotnet/
COPY src/dotnet/ApiSdk/ApiSdk.csproj src/dotnet/ApiSdk/
COPY src/dotnet/ApiSdk.Tests/ApiSdk.Tests.csproj src/dotnet/ApiSdk.Tests/
# Utils solution (ApiSdk.UsageCase) - references ../../../src/dotnet/ApiSdk
COPY utils/dotnet/ApiSdk.UsageCase/ApiSdk.UsageCase.csproj utils/dotnet/ApiSdk.UsageCase/

RUN dotnet restore src/dotnet/ApiSdk.sln \
    && dotnet restore utils/dotnet/ApiSdk.UsageCase/ApiSdk.UsageCase.csproj

# --- Source layer: copy the actual sources, then build/test. ----------------
COPY src/dotnet/ src/dotnet/
COPY utils/dotnet/ApiSdk.UsageCase/ utils/dotnet/ApiSdk.UsageCase/

# Build the whole SDK solution in Release (no restore - already restored above).
RUN dotnet build src/dotnet/ApiSdk.sln -c Release --no-restore

# xUnit GATE: a failing test aborts the build here.
RUN dotnet test src/dotnet/ApiSdk.sln -c Release --no-build --no-restore --verbosity normal

# Publish the .NET usage runner (self-references the built ApiSdk project).
RUN dotnet publish utils/dotnet/ApiSdk.UsageCase/ApiSdk.UsageCase.csproj \
    -c Release --no-restore -o /publish/dotnet-usage

# =============================================================================
# Stage: node-test - JS build + `node --test` gate + stage usage runner
# =============================================================================
FROM node:20-alpine AS node-test
# The in-image tree mirrors the repo so paths line up:
#   SDK  at /src/src/js   (dist -> /src/src/js/dist)
#   CLI  at /src/utils/js (resolves @api-sdk/js via file:../../src/js)
#   data at /src/data     (reader.test.ts reads it; see below)
WORKDIR /src/src/js

# --- SDK dependency layer: manifests + tsconfig first for caching. ----------
COPY src/js/package*.json ./
COPY src/js/tsconfig.json ./
RUN npm install

# --- SDK source + build (compile then `node --test` - the JS unit gate). ----
COPY src/js/src/ ./src/
# reader.test.ts reads the REAL sample data, resolving REPO_ROOT as
# resolve(__dirname=/src/src/js/dist/__tests__, '..','..','..','..') = /src,
# then /src/data/FlatFileSample/.../RefData. So the data tree must be present
# at /src/data during the test gate. (Runtime images do NOT bake data in; it is
# mounted there. Here it is build-time test input only.)
COPY data/ /src/data/
# `npm run build` == `tsc` then `node --test dist/__tests__/` - the unit gate.
# A failing unit test aborts the build here.
RUN npm run build

# --- Usage runner: links @api-sdk/js via file:../../src/js. ------------------
WORKDIR /src/utils/js
COPY utils/js/package*.json ./
RUN npm install
COPY utils/js/ ./

# =============================================================================
# Stage: dotnet-usage - thin .NET runtime image (single runtime, no node)
# =============================================================================
FROM mcr.microsoft.com/dotnet/runtime:9.0 AS dotnet-usage
WORKDIR /app

# Published usage runner only. ApiSdk.UsageCase walks UP from AppContext.BaseDirectory
# (/app) looking for data/FlatFileSample/.../RefData, so data/ is mounted at /app/data.
COPY --from=dotnet-test /publish/dotnet-usage/ ./

ENTRYPOINT ["dotnet", "ApiSdk.UsageCase.dll"]

# =============================================================================
# Stage: node-usage - thin Node runtime image
# =============================================================================
# Layout rationale (must satisfy BOTH JS entrypoints):
#   * usageCase.js: ROOT = resolve(__dirname, '..', '..'); reads ROOT/data/...
#     -> usageCase.js at /app/utils/js  =>  ROOT = /app  =>  /app/data/... OK
#   * SDKCLI.js: getProjectRoot() returns '/app' when __dirname startsWith '/app',
#     then reads /app/config.json and resolves basePath against /app.
#     -> __dirname = /app/utils/js (startsWith '/app') => root /app OK
# So utils/js lives at /app/utils/js; data/ and config.json mount at /app.
FROM node:20-alpine AS node-usage
WORKDIR /app/utils/js

# Built SDK package (dist + package.json) so @api-sdk/js resolves.
COPY --from=node-test /src/src/js/dist /app/src/js/dist
COPY --from=node-test /src/src/js/package.json /app/src/js/package.json

# Usage runner (usageCase.js, SDKCLI.js, tui.js, package.json, node_modules).
COPY --from=node-test /src/utils/js/ /app/utils/js/

# Recreate the @api-sdk/js symlink so the `file:../../src/js` import resolves
# to the built SDK inside the image (host node_modules is .dockerignored).
RUN mkdir -p node_modules/@api-sdk \
    && rm -rf node_modules/@api-sdk/js \
    && ln -s /app/src/js node_modules/@api-sdk/js

# Default: run the self-verifying usage/example suite. Compose overrides this
# for the interactive SDKCLI.js TUI service.
CMD ["node", "usageCase.js"]

# =============================================================================
# Stage: gate - fan-in that forces BOTH test gates in one build.
# =============================================================================
# Building this stage transitively requires dotnet-test (xUnit) AND node-test
# (node --test). `docker compose build` builds it, so a single command runs
# every test gate. It carries no payload; it just `true`s.
FROM alpine:3.20 AS gate
COPY --from=dotnet-test /publish/dotnet-usage/ApiSdk.UsageCase.dll /gate/dotnet.ok
COPY --from=node-test /src/src/js/dist/index.js /gate/node.ok
CMD ["/bin/true"]
