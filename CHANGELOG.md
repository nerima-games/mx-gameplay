# @nerima-games/mx-gameplay

## 0.3.2

### Patch Changes

- [`071b1cd`](https://github.com/nerima-games/mx-gameplay/commit/071b1cdf94d33324b976fd06f9e51a6402b36868) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate to the org-wide package standard: source moved under `src/`, the
  `api-lock`/`check-dependency-whitelist` custom gates were replaced by
  `.oxlintrc.json`'s `no-restricted-imports`, GitHub Actions are now SHA-pinned,
  Dependabot and changesets were added, and the previously-undeclared
  `@nerima-games/mc-audio` runtime dependency (used per this repository's
  declared Tier3 parents in `docs/architecture.md` and `DEPENDENCY_POLICY.md`)
  was added to `dependencies`. No public API changes.

- [#9](https://github.com/nerima-games/mx-gameplay/pull/9) [`56fdd33`](https://github.com/nerima-games/mx-gameplay/commit/56fdd3319e3d63e427efdca405dd02975d838341) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix oxlint violations surfaced by nixpkgs' oxlint 1.73 (categories were left
  "warn" instead of "off", and individual rules flagged real shadowing/magic-number/
  no-empty issues once enforced) and close the coverage gate back to the declared
  99% threshold on all four metrics, with real behavioral tests for every
  reachable branch and `v8 ignore` pragmas — each with a stated rationale,
  matching this repository's existing convention — for the branches proven
  unreachable. No public API changes.

- [#12](https://github.com/nerima-games/mx-gameplay/pull/12) [`4a8d438`](https://github.com/nerima-games/mx-gameplay/commit/4a8d438f78a2bbccab7764df01b606b6017d3671) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added

## 0.1.44

### Patch Changes

- Integrate deterministic hostile mob despawning into the live mob frame with persistent snapshot state and save/restore compatibility.

## 0.1.43

### Patch Changes

- Add deterministic age, distance, persistence, difficulty, and random hostile mob despawn rules.

## 0.1.42

### Patch Changes

- Add deterministic Enderman teleport landing validation for loaded, solid, clear, hazard-free destinations and environmental escape triggers.

## 0.1.41

### Patch Changes

- Add deterministic fire spreading, fuel consumption, weather extinguishing, natural expiry, and contact damage events.

## 0.1.38

### Patch Changes

- [`f478ee0`](https://github.com/nerima-games/mx-gameplay/commit/f478ee06aea11d787a5c7aca4e4d0d7b2870f038) Thanks [@takeokunn](https://github.com/takeokunn)! - Add bounded furnace advance planning, stale-plan-safe application, and item-use stage routing over mc-sim-owned furnace state.

- Add Efficiency-aware mining speed to the bounded mining progress API.

- [#1](https://github.com/nerima-games/mx-gameplay/pull/1) [`9cee47c`](https://github.com/nerima-games/mx-gameplay/commit/9cee47cc22e9027afb231e87a1117679ae9ab05e) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate to the org-wide package standard: source moved under `src/`, the
  `api-lock`/`check-dependency-whitelist` custom gates were replaced by
  `.oxlintrc.json`'s `no-restricted-imports`, GitHub Actions are now SHA-pinned,
  Dependabot and changesets were added, and the previously-undeclared
  `@nerima-games/mc-audio` runtime dependency (used per this repository's
  declared Tier3 parents in `docs/architecture.md` and `DEPENDENCY_POLICY.md`)
  was added to `dependencies`. No public API changes.
