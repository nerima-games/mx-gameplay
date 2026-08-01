# @nerima-games/mx-gameplay

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
