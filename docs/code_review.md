# Code review policy

Review for:

## Correctness
- Broken edge cases
- Race conditions
- Bad error handling
- Incorrect async/await or promise handling
- Incomplete transaction handling
- Data consistency problems

## Tests
- Missing unit tests for changed logic
- Missing integration tests for auth, payments, permissions, background jobs, or data migrations
- Tests that assert implementation details instead of behavior

## Maintainability
- Overly complex functions
- Duplicate logic
- Unclear boundaries between modules
- Hidden coupling
- Unhandled null/undefined cases
- Poor naming only when it creates ambiguity or future risk

## Output format

For every finding, use:

- Severity: P0/P1/P2
- File and line
- Problem
- Why it matters
- Suggested fix
- Test that should cover it

Only report issues with concrete evidence from the code.