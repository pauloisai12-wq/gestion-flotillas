# Security review policy

Focus on realistic exploit paths, not theoretical noise.

Check:

## Authentication and authorization
- Missing auth middleware
- Broken role/tenant checks
- IDOR / object-level authorization
- Privilege escalation
- Session/token misuse

## Input handling
- SQL/NoSQL injection
- Command injection
- Path traversal
- SSRF
- XSS
- Unsafe deserialization
- ReDoS

## Secrets and sensitive data
- Hardcoded secrets
- Logging tokens, passwords, PII, API keys, cookies, auth headers
- Weak cryptography
- Missing encryption for sensitive data

## Infrastructure and dependencies
- Dangerous dependency changes
- Insecure defaults
- Unsafe CORS
- Overly permissive file/network access

## Required behavior

Do not scan the entire repository blindly.
Start from the diff, then follow data flow into related files.
For each finding, include:
- Attack path
- Preconditions
- Impact
- Evidence
- Minimal patch idea
- How to validate the fix