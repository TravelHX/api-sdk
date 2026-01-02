# Multi-stage Dockerfile for API SDK Test Runner
# Includes both .NET and Node.js runtimes

# Stage 1: Build .NET SDK
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS dotnet-build
WORKDIR /src

# Copy .NET SDK source
COPY src/dotnet/ApiSdk/ApiSdk.csproj src/dotnet/ApiSdk/
RUN dotnet restore src/dotnet/ApiSdk/ApiSdk.csproj

COPY src/dotnet/ApiSdk/ src/dotnet/ApiSdk/
RUN dotnet build src/dotnet/ApiSdk/ApiSdk.csproj -c Release -o /app/dotnet-sdk

# Copy .NET Test Runner source
COPY utils/dotnet/ApiSdk.TestRunner/ApiSdk.TestRunner.csproj utils/dotnet/ApiSdk.TestRunner/
RUN dotnet restore utils/dotnet/ApiSdk.TestRunner/ApiSdk.TestRunner.csproj

COPY utils/dotnet/ApiSdk.TestRunner/ utils/dotnet/ApiSdk.TestRunner/
RUN dotnet build utils/dotnet/ApiSdk.TestRunner/ApiSdk.TestRunner.csproj -c Release -o /app/dotnet-testrunner

# Stage 2: Build Node.js SDK
FROM node:20-alpine AS node-build
WORKDIR /src

# Copy Node.js SDK package files and tsconfig.json
COPY src/js/package*.json src/js/
COPY src/js/tsconfig.json src/js/
WORKDIR /src/src/js
# Use npm install instead of npm ci if package-lock.json might not exist
RUN npm install

# Copy source files (exclude node_modules and dist)
COPY src/js/src/ src/js/src/
# Build the SDK
RUN npm run build

# Copy Node.js Test Runner
WORKDIR /src
COPY utils/js/package*.json utils/js/
WORKDIR /src/utils/js
# Use npm install instead of npm ci if package-lock.json might not exist
RUN npm install

COPY utils/js/ utils/js/

# Stage 3: Runtime image with both .NET and Node.js
FROM mcr.microsoft.com/dotnet/runtime:9.0

# Install Node.js
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy .NET runtime files
COPY --from=dotnet-build /app/dotnet-sdk /app/dotnet-sdk
COPY --from=dotnet-build /app/dotnet-testrunner /app/dotnet-testrunner

# Copy Node.js SDK files
COPY --from=node-build /src/src/js/dist /app/js-sdk/dist
COPY --from=node-build /src/src/js/package.json /app/js-sdk/

# Copy Node.js Test Runner files (node_modules included if it exists)
COPY --from=node-build /src/utils/js /app/js-testrunner

# Create directory structure and symlink so test-runner can access SDK
# The test-runner imports from '../../src/js/dist/api-sdk.js'
# So we need: /app/js-testrunner/../../src/js/dist -> /app/js-sdk/dist
RUN mkdir -p /app/src/js && \
    ln -s /app/js-sdk/dist /app/src/js/dist || true

# Copy data and config
COPY data/ /app/data/
COPY config.json /app/

# Set environment variables
ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="${PATH}:/usr/share/dotnet"

# Default to .NET test runner
ENTRYPOINT ["dotnet", "/app/dotnet-testrunner/ApiSdk.TestRunner.dll"]

