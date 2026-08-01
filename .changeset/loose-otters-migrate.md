---
"@nerima-games/mx-gameplay": patch
---

Migrate to the org-wide package standard: source moved under `src/`, the
`api-lock`/`check-dependency-whitelist` custom gates were replaced by
`oxlint.json`'s `no-restricted-imports`, GitHub Actions are now SHA-pinned,
Dependabot and changesets were added, and the previously-undeclared
`@nerima-games/mc-audio` runtime dependency (used per this repository's
declared Tier3 parents in `docs/architecture.md` and `DEPENDENCY_POLICY.md`)
was added to `dependencies`. No public API changes.
