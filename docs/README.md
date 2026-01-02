# API SDK

A cross-platform SDK that abstracts calls to both flat file storage (series of JSON files) and an OTA API. The SDK is available as both a NuGet package for .NET and an npm package for JavaScript/TypeScript.

## Requirements

### Infrastructure
- Support for both .NET and JavaScript/TypeScript platforms
- .NET SDK distributed as NuGet package
- JavaScript SDK distributed as npm package
- Test infrastructure for both platforms
- Internal console applications (.NET and Node.js) for validation and testing
- Interactive console application that starts a test run
- Test run ingests test data from the data folder (configurable via config.json)
- Test run outputs to console every call and response

### Flat File Support
- Ability to read from flat file storage (series of JSON files)
- Accept a file path as input parameter
- Abstract file reading operations through the SDK interface

### OTA API Support
- Ability to make calls to the OTA API
- Abstract API communication through the SDK interface

## Project Structure

- `docs/` - Documentation files (README, API docs, guides, etc.)
- `src/` - Source code files
- `test/` - Test files and test data
- `utils/` - Utility scripts and helper functions

