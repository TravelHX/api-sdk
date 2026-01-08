# Global Cursor Rules

## Project Structure
Always create the following basic folder structure for every new project:
- `docs/` - Documentation files (README, API docs, guides, etc.)
- `src/` - Source code files
- `test/` - Test files and test data
- `data/` - Sample data files, JSON files, and test fixtures
- `utils/` - Utility scripts and helper functions

## Code Standards
- Follow consistent naming conventions
- Add appropriate comments and documentation
- Use meaningful variable and function names
- Include error handling where appropriate

## Testing Requirements
- Every code change MUST have an accompanying test
- Before committing ANY changes, ALL tests MUST pass
- Run the full test suite before committing to ensure no regressions
- Tests should cover both positive and negative cases
- New features must include tests demonstrating their functionality

## File Organization
- Keep related files grouped together
- Use clear, descriptive file names
- Maintain consistent directory structure across projects

## Git Operations
- NEVER perform git actions (commit, push, pull, etc.) without explicit user request
- Only suggest git commands when appropriate, do not execute them automatically
- Always ask for confirmation before any git operations
- NEVER commit sensitive files like config.json.development or credentials
- Always respect .gitignore rules and never commit excluded files
- Before committing, verify that ALL tests pass (see Testing Requirements section)

## Character Encoding and Documentation
- NEVER use Unicode characters (emojis, special symbols) in code or scripts
- Use only ASCII characters for compatibility across all systems
- Only create a single README.md file per project (in the `docs/` folder)
- Do not create multiple README files in subdirectories unless specifically requested
- Use clear ASCII text for status indicators and output messages

## Feature Requests and Documentation Updates
- When a feature request or requirement is issued, please update both the `docs/README.md` and `docs/todo.md` files
- Both README.md and todo.md files MUST be located in the `docs/` folder
- New feature request should result in additional requirement in the README.md, and the steps to implement in todo.md
- todo.md should be a numbered list of tasks, starting with 1 and phased (e.g. phase 1 should consist of a discrete piece of logically separate functionality)
- Phases should contain points that have sections and subsections - e.g. 6.1.1, 6.1.2 (hierarchical numbering with sections and subsections)
- New items are never added higher than a phase that has completed items in
- DO NOT write any code when a feature is requested - only update documentation (`docs/README.md` and `docs/todo.md`)
- Code implementation should only begin when the feature implementation is explicitly requested by the user
- This separates feature planning/documentation from feature implementation

## Bug Reporting and Documentation
- When a bug is reported, create a new document in the `docs/` folder
- Bug document naming format: `[number]-[description].md` (e.g., `001-WrongFieldsInAnalysis.md`)
- Bug documents are living documents that should include:
  - Nature of the bug (description, symptoms, affected areas)
  - Status: Active or Closed
  - Work done so far to fix it (investigation, attempted fixes, test results)
  - Any additional notes or observations
- When a bug is fixed, move the bug document to the `docs/fixed/` subfolder
- DO NOT perform any work to fix the bug when it is reported - only create the bug documentation
- Bug fixes should only begin when explicitly requested by the user
- This separates bug reporting/documentation from bug fixing

## Bug Fixing Procedure
When fixing a bug, the following procedure MUST be adhered to:
1. There must be an associated bug document in `docs/`
2. Before starting work on a bug, a failing test MUST be created that proves the bug exists (the test should fail initially, demonstrating the bug)
3. The associated bug document MUST be updated for every task that occurs on the bug (investigation, code changes, testing, etc.)
4. The bug can only be marked as passing when the created test passes (confirming the bug is fixed)
5. Once the bug is fixed and the test passes, move the bug document to `docs/fixed/` subfolder
