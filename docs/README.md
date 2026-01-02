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
- Test run ingests the entire suite of files (all files listed in config.json), not individual files
- Test run outputs to console every call and response
- Console application menu with options to run .NET SDK or NodeJS SDK against flat files
- Console application menu options:
  - 0. Show configuration
  - 1. Run All Automated Tests
  - 2. Specify Test File Suite Location / name (displays currently selected test suite location / name)
  - 3. Run .Net SDK against flat file suite
  - 4. Run NodeJS SDK against flat file suite
  - 5. Exit

### Flat File Support
- Ability to read from flat file storage (series of JSON files)
- Accept a file path as input parameter for individual file operations
- Process entire suite of files (all files configured in config.json) for ingestion operations
- Abstract file reading operations through the SDK interface

### OTA API Support
- Ability to make calls to the OTA API
- Abstract API communication through the SDK interface

## Project Structure

- `docs/` - Documentation files (README, API docs, guides, etc.)
- `src/` - Source code files
- `test/` - Test files and test data
- `utils/` - Utility scripts and helper functions

