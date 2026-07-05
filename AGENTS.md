# AGENTS.md

## Project map

- Architecture overview: docs/architecture.md
- Code review rules: docs/code_review.md
- Security review rules: docs/security_review.md
- Testing instructions: docs/testing.md

## Review guidelines

When reviewing code, do not try to load the entire repository into context.

First inspect:
1. The PR diff or current git diff.
2. The nearest related files.
3. Public entry points, auth boundaries, data validation, database access, filesystem/network calls, secrets handling, and dependency changes.
4. Tests that cover the changed behavior.

Prioritize only actionable findings:
- P0: exploitable vulnerability, data loss, auth bypass, secret exposure, production outage.
- P1: likely bug, missing authorization, unsafe input handling, missing test for risky behavior.
- P2: maintainability, readability, non-blocking quality issue.

Avoid low-value comments. Do not comment on style unless it creates risk or violates project rules.

Before finalizing, run the relevant tests, linter, type checker, and security checks when available.