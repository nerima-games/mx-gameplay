---
"@nerima-games/mx-gameplay": patch
---

Fix oxlint violations surfaced by nixpkgs' oxlint 1.73 (categories were left
"warn" instead of "off", and individual rules flagged real shadowing/magic-number/
no-empty issues once enforced) and close the coverage gate back to the declared
99% threshold on all four metrics, with real behavioral tests for every
reachable branch and `v8 ignore` pragmas — each with a stated rationale,
matching this repository's existing convention — for the branches proven
unreachable. No public API changes.
