# Security Guidelines

## Pre-commit checklist
Before any commit:
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitized HTML)
- CSRF protection enabled
- Authentication and authorization verified
- Rate limiting on endpoints
- Error messages don't leak sensitive data

## Secret management
Secrets come from environment variables, never hardcoded. Read them from `process.env` (or the platform equivalent) and fail loudly at startup if a required one is missing.

## If a security issue is found
1. Stop.
2. Use the **security-reviewer** agent.
3. Fix critical issues before continuing.
4. Rotate any exposed secrets.
5. Review the codebase for similar issues.
