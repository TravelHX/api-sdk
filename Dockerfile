# syntax=docker/dockerfile:1
#
# Canonical, system-agnostic build + test path for the API SDK.
#
# One multi-stage build with named --target stages:
#   dotnet-test  : restore + build + `dotnet test` (xUnit gate) + PACK the SDK
#                  to a local NuGet feed + publish the .NET usage runners off it
#   node-test    : npm install + `npm run build` (tsc + node --test gate) + PACK
#                  the SDK to a local tgz + install the JS usage runner off it
#   dotnet-usage : thin .NET runtime image that runs ApiSdk.UsageCase.dll
#   node-usage   : thin Node runtime image that runs usageCase.js / SDKCLI.js
#   gate         : fan-in that forces BOTH test gates in a single `docker build`/`compose build`
#
# Test gates fail the build: `dotnet test` and `node --test` run during the
# respective *-test stages, so any failing test aborts the image build.
#
# SDK-as-artifact contract (mirrors the host build):
#   The usage/CLI projects do NOT reference the SDK source. They consume it as a
#   PACKED ARTIFACT only -- a NuGet .nupkg (.NET) / an npm .tgz (JS) produced by
#   `dotnet pack` / `npm pack` during the *-test stages into an in-image local
#   feed. The in-image tree mirrors the repo (/src == repo root) so the same
#   repo-relative feed paths used on the host resolve unchanged:
#     .NET: utils/dotnet/NuGet.config -> ../../artifacts/nuget -> /src/artifacts/nuget
#     JS:   utils/js/package.json     -> file:../../artifacts/npm/api-sdk-js-1.0.0.tgz
#                                        -> /src/artifacts/npm/api-sdk-js-1.0.0.tgz
#   A missing feed is therefore a hard build failure -- the correct guarantee.
#
# config.json and data/ are intentionally NOT baked into the runtime images;
# they are mounted read-only via docker-compose so the images stay generic.
# The runtime images contain NO SDK source tree -- only the published output /
# the extracted artifact in node_modules.

# =============================================================================
# Stage: dotnet-test - .NET build + xUnit gate + publish usage runner
# =============================================================================
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS dotnet-test
WORKDIR /src

# --- SDK restore layer: copy ONLY the SDK solution metadata first so the (slow)
#     restore is cached and only re-runs when an SDK csproj/sln changes. -------
# SDK solution (ApiSdk + ApiSdk.Tests). The utils projects are NOT part of this
# restore -- they no longer reference the SDK source; they consume the packed
# .nupkg produced below, so their restore happens AFTER the pack.
COPY src/dotnet/ApiSdk.sln src/dotnet/
COPY src/dotnet/ApiSdk/ApiSdk.csproj src/dotnet/ApiSdk/
COPY src/dotnet/ApiSdk.Tests/ApiSdk.Tests.csproj src/dotnet/ApiSdk.Tests/

RUN dotnet restore src/dotnet/ApiSdk.sln

# --- SDK source layer: copy the actual sources, then build/test/pack. --------
COPY src/dotnet/ src/dotnet/

# Build the whole SDK solution in Release (no restore - already restored above).
RUN dotnet build src/dotnet/ApiSdk.sln -c Release --no-restore

# xUnit GATE: a failing test aborts the build here.
RUN dotnet test src/dotnet/ApiSdk.sln -c Release --no-build --no-restore --verbosity normal

# PACK the SDK into the in-image local NuGet feed. The path /src/artifacts/nuget
# is exactly where utils/dotnet/NuGet.config's "../../artifacts/nuget" resolves
# (relative to /src/utils/dotnet), so the usage projects find ApiSdk.1.0.0.nupkg
# here -- and ONLY here (no ProjectReference exists anymore).
RUN dotnet pack src/dotnet/ApiSdk/ApiSdk.csproj -c Release -o /src/artifacts/nuget

# --- Utils restore layer: now that the .nupkg exists in the local feed, copy
#     the NuGet.config + utils csprojs and restore. ApiSdk resolves PURELY from
#     the packed feed; a missing/empty feed would fail here by design. ---------
COPY utils/dotnet/NuGet.config utils/dotnet/
COPY utils/dotnet/ApiSdk.UsageCase/ApiSdk.UsageCase.csproj utils/dotnet/ApiSdk.UsageCase/
COPY utils/dotnet/ApiSdk.SDKCLI/ApiSdk.SDKCLI.csproj utils/dotnet/ApiSdk.SDKCLI/

RUN dotnet restore utils/dotnet/ApiSdk.UsageCase/ApiSdk.UsageCase.csproj \
    && dotnet restore utils/dotnet/ApiSdk.SDKCLI/ApiSdk.SDKCLI.csproj

# --- Utils source layer: copy runner sources, then publish off the artifact. -
COPY utils/dotnet/ApiSdk.UsageCase/ utils/dotnet/ApiSdk.UsageCase/
COPY utils/dotnet/ApiSdk.SDKCLI/ utils/dotnet/ApiSdk.SDKCLI/

# Publish the .NET usage runner. It links ApiSdk from the packed .nupkg, NOT
# from any source project (none is referenced or present in this stage's graph).
RUN dotnet publish utils/dotnet/ApiSdk.UsageCase/ApiSdk.UsageCase.csproj \
    -c Release --no-restore -o /publish/dotnet-usage

# Publish the interactive .NET SDK CLI (TUI). config.json/data are NOT part of
# the project, so nothing is baked in; they are mounted read-only at runtime.
RUN dotnet publish utils/dotnet/ApiSdk.SDKCLI/ApiSdk.SDKCLI.csproj \
    -c Release --no-restore -o /publish/sdkcli

# =============================================================================
# Stage: node-test - JS build + `node --test` gate + stage usage runner
# =============================================================================
# node:22 (not 20): the SDK unit gate runs `node --test "dist/__tests__/**/*.test.js"`,
# and glob-pattern expansion by the built-in test runner is only supported from
# Node 21+. On node:20 the pattern is taken literally and matches nothing, so the
# gate spuriously fails. node:22-alpine is the current LTS and runs the suite.
FROM node:22-alpine AS node-test
# The in-image tree mirrors the repo so paths line up:
#   SDK     at /src/src/js   (dist -> /src/src/js/dist)
#   feed    at /src/artifacts/npm/api-sdk-js-1.0.0.tgz (packed SDK artifact)
#   CLI     at /src/utils/js (resolves @api-sdk/js via
#                             file:../../artifacts/npm/api-sdk-js-1.0.0.tgz)
#   data    at /src/data     (reader.test.ts reads it; see below)
WORKDIR /src/src/js

# --- SDK dependency layer: manifests + tsconfig first for caching. ----------
COPY src/js/package*.json ./
COPY src/js/tsconfig.json ./
RUN npm install

# --- SDK source + build (compile then `node --test` - the JS unit gate). ----
COPY src/js/src/ ./src/
# reader.test.ts reads the REAL sample data, resolving REPO_ROOT as
# resolve(__dirname=/src/src/js/dist/__tests__, '..','..','..','..') = /src,
# then /src/data/flatfiles_dev/flatfiles_dev/RefData. So the data tree must be present
# at /src/data during the test gate. (Runtime images do NOT bake data in; it is
# mounted there. Here it is build-time test input only.)
COPY data/ /src/data/
# `npm run build` == `tsc` then `node --test dist/__tests__/` - the unit gate.
# A failing unit test aborts the build here.
RUN npm run build

# PACK the SDK into the in-image local feed. `npm pack` honours the package's
# "files":["dist"] allow-list, so the tarball carries the built dist + manifest.
# The path /src/artifacts/npm matches utils/js/package.json's
# file:../../artifacts/npm/... (relative to /src/utils/js), so the usage runner
# installs ApiSdk from THIS tarball -- and only this tarball.
RUN mkdir -p /src/artifacts/npm && npm pack --pack-destination /src/artifacts/npm
# Normalise the name: npm pack derives the filename from name+version
# (@api-sdk/js@1.0.0 -> api-sdk-js-1.0.0.tgz), which already matches the
# dependency spec. Assert it exists so a packaging change fails loudly here.
RUN test -f /src/artifacts/npm/api-sdk-js-1.0.0.tgz

# --- Usage runner: installs @api-sdk/js from the packed tgz (EXTRACTED into
#     node_modules as a real copy -- NOT a file:dir symlink to source). --------
WORKDIR /src/utils/js
# Copy only package.json (not the host lockfile) so npm re-resolves the
# integrity of the freshly in-image-packed tgz instead of failing on a stale
# host hash. The dependency spec itself is the file: tarball path.
COPY utils/js/package.json ./
RUN npm install
COPY utils/js/ ./
# Defensive: re-copying utils/js/ above may have brought a host node_modules in
# (it is .dockerignored, so normally not) -- but never a source symlink. The
# install above produced node_modules/@api-sdk/js as an extracted real dir.

# =============================================================================
# Stage: dotnet-usage - thin .NET runtime image (single runtime, no node)
# =============================================================================
FROM mcr.microsoft.com/dotnet/runtime:9.0 AS dotnet-usage
WORKDIR /app

# Published usage runner only. ApiSdk.UsageCase walks UP from AppContext.BaseDirectory
# (/app) looking for data/flatfiles_dev/flatfiles_dev/RefData, so data/ is mounted at /app/data.
COPY --from=dotnet-test /publish/dotnet-usage/ ./

ENTRYPOINT ["dotnet", "ApiSdk.UsageCase.dll"]

# =============================================================================
# Stage: dotnet-cli - thin .NET runtime image for the interactive SDK CLI (TUI)
# =============================================================================
# ApiSdk.SDKCLI detects /app/config.json and treats /app as the project root,
# then resolves data paths against it. So config.json and data/ are mounted at
# /app (read-only) via docker-compose; nothing is baked into this image.
FROM mcr.microsoft.com/dotnet/runtime:9.0 AS dotnet-cli
WORKDIR /app

# Published interactive SDK CLI only.
COPY --from=dotnet-test /publish/sdkcli/ ./

ENTRYPOINT ["dotnet", "ApiSdk.SDKCLI.dll"]

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
# Keep the runtime base in lockstep with node-test (node:22-alpine) so the
# node_modules carried over from there runs on the same major.
FROM node:22-alpine AS node-usage
WORKDIR /app/utils/js

# Carry the ALREADY-INSTALLED usage runner from node-test: its node_modules
# contains @api-sdk/js as an EXTRACTED real copy of the packed tarball. No SDK
# source tree (/app/src/js) and no symlink-to-source exist in this image -- the
# runtime consumes the SDK purely from the artifact inside node_modules.
COPY --from=node-test /src/utils/js/ /app/utils/js/

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
