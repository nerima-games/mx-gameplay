/**
 * The gate that keeps mx-gameplay from quietly becoming a monolith.
 *
 * plan.md §3.11 says this repository will have the highest change frequency of
 * the sixteen (200 commits in three months in the reference) and must NOT be
 * split further. A repository that changes constantly and is never allowed to
 * split is precisely the one that will grow an import it should not have, so
 * these assertions matter more here than anywhere else.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  allowedDirectDependencies,
  checkDeclaredDependencies,
  checkPolicyConfiguration,
  classifyImport,
  findBannedTimeSources,
  isToolingOrTestPath,
  REPOSITORY_POLICY,
  SCAN_ROOTS,
  type DeclaredDependencies,
  type PolicyView,
} from '../scripts/check-dependency-whitelist'

const SHIPPED = 'src/stages/registration.ts'
const TOOLING = 'test/some.test.ts'

const declared = (
  dependencies: ReadonlyArray<string>,
  devDependencies: ReadonlyArray<string> = [],
): DeclaredDependencies => ({
  dependencies: new Set(dependencies),
  devDependencies: new Set(devDependencies),
})

const REAL_DEPENDENCIES = declared([
  '@nerima-games/mc-kernel',
  '@nerima-games/mc-sim',
  '@nerima-games/mc-worldgen',
  '@nerima-games/mc-audio',
])

/**
 * The same 16-repository roster, read as if this gate were installed in another
 * repository.
 *
 * Every copy of `check-dependency-whitelist.ts` carries the whole graph, so a
 * mistake in a row belonging to somebody else is invisible from this seat — the
 * import check only ever consults `thisPackage`'s row. Re-seating the policy is
 * how those rows get exercised at all.
 */
const seatOf = (thisPackage: string): PolicyView => ({
  thisPackage,
  dependencyGraph: REPOSITORY_POLICY.dependencyGraph,
  aliases: REPOSITORY_POLICY.aliases,
})

describe('mx-gameplay dependency policy', () => {
  it.effect('declares exactly the parents plan.md §3.11 gives it: sim, worldgen, audio', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.thisPackage).toBe('@nerima-games/mx-gameplay')
      expect([...allowedDirectDependencies()].sort()).toStrictEqual([
        '@nerima-games/mc-audio',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
      ])
    }),
  )

  it.effect('carries the complete 16-repository roster, so cycle detection can see the whole organisation', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.dependencyGraph.size).toBe(16)
      expect(checkPolicyConfiguration()).toStrictEqual([])
    }),
  )
})

describe('§2.3-1: zero dependency edges between experience modules', () => {
  const SIBLINGS = [
    '@nerima-games/mx-redstone',
    '@nerima-games/mx-ui',
    '@nerima-games/mx-multiplayer',
  ] as const

  it.effect('REGRESSION: no experience module names another experience module in the graph', () =>
    Effect.sync(() => {
      const experienceModules = [
        '@nerima-games/mx-gameplay',
        ...SIBLINGS,
      ] as ReadonlyArray<string>

      for (const module of experienceModules) {
        const parents = REPOSITORY_POLICY.dependencyGraph.get(module) ?? new Set<string>()
        for (const parent of parents) {
          expect(experienceModules).not.toContain(parent)
        }
      }
    }),
  )

  it.effect('REGRESSION: importing mx-redstone, mx-ui or mx-multiplayer is rejected outright', () =>
    Effect.sync(() => {
      for (const sibling of SIBLINGS) {
        const violation = classifyImport(
          { importedPackage: sibling, filePath: SHIPPED, line: 1, isToolingOrTest: false },
          REAL_DEPENDENCIES,
        )
        expect(violation?.rule).toBe('not-whitelisted')
        // "Mining puts an item in the inventory" goes through mc-sim's
        // InventoryService. If you want mx-ui's hotbar to react to a mined
        // block, write to mc-sim and let mx-ui read it.
        expect(violation?.message).toContain('not a direct dependency')
      }
    }),
  )
})

describe('no transitive closure', () => {
  it.effect('REGRESSION: mx-gameplay may NOT import mc-physics just because mc-sim does', () =>
    Effect.sync(() => {
      const violation = classifyImport(
        {
          importedPackage: '@nerima-games/mc-physics',
          filePath: SHIPPED,
          line: 12,
          isToolingOrTest: false,
        },
        REAL_DEPENDENCIES,
      )

      expect(violation?.rule).toBe('transitive-import')
      expect(violation?.message).toContain(
        '@nerima-games/mx-gameplay -> @nerima-games/mc-sim -> @nerima-games/mc-physics',
      )
    }),
  )

  it.effect('REGRESSION: mc-save and mc-meshing are equally out of reach', () =>
    Effect.sync(() => {
      for (const reached of ['@nerima-games/mc-save', '@nerima-games/mc-meshing']) {
        const violation = classifyImport(
          { importedPackage: reached, filePath: SHIPPED, line: 1, isToolingOrTest: false },
          REAL_DEPENDENCIES,
        )
        expect(violation).toBeDefined()
      }
    }),
  )

  it.effect('the three declared parents ARE importable from shipped source', () =>
    Effect.sync(() => {
      for (const parent of allowedDirectDependencies()) {
        expect(
          classifyImport(
            { importedPackage: parent, filePath: SHIPPED, line: 1, isToolingOrTest: false },
            REAL_DEPENDENCIES,
          ),
        ).toBeUndefined()
      }
    }),
  )

  it.effect('mc-kernel is importable without appearing in any allowlist, but must still be declared', () =>
    Effect.sync(() => {
      expect(
        classifyImport(
          {
            importedPackage: '@nerima-games/mc-kernel',
            filePath: SHIPPED,
            line: 1,
            isToolingOrTest: false,
          },
          REAL_DEPENDENCIES,
        ),
      ).toBeUndefined()

      expect(
        classifyImport(
          {
            importedPackage: '@nerima-games/mc-kernel',
            filePath: SHIPPED,
            line: 1,
            isToolingOrTest: false,
          },
          declared([]),
        )?.rule,
      ).toBe('undeclared-dependency')
    }),
  )
})

describe('§2.3-2: mc-playground-kit is devDependency-only', () => {
  const KIT = '@nerima-games/mc-playground-kit'

  it.effect('REGRESSION: kit in "dependencies" is an error, because it would delete input handling from the shipped game', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies(declared([KIT]))
      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('dev-only-package-in-dependencies')
      expect(violations[0]?.message).toContain('delete input handling')
    }),
  )

  it.effect('REGRESSION: importing kit from shipped source is an error even if it is declared correctly', () =>
    Effect.sync(() => {
      const violation = classifyImport(
        { importedPackage: KIT, filePath: SHIPPED, line: 1, isToolingOrTest: false },
        declared([], [KIT]),
      )
      expect(violation?.rule).toBe('dev-only-package-in-shipped-source')
    }),
  )

  it.effect('kit IS allowed from the preview harness, which is the whole reason it exists', () =>
    Effect.sync(() => {
      expect(checkDeclaredDependencies(declared([], [KIT]))).toStrictEqual([])
      expect(
        classifyImport(
          { importedPackage: KIT, filePath: TOOLING, line: 1, isToolingOrTest: true },
          declared([], [KIT]),
        ),
      ).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: `src/stages/` counts as shipped source, not as tooling', () =>
    Effect.sync(() => {
      // Getting this predicate wrong in the permissive direction would legalise
      // the one import this project most needs to forbid.
      expect(isToolingOrTestPath('src/stages/registration.ts')).toBe(false)
      expect(isToolingOrTestPath('src/domain/falling-block.ts')).toBe(false)
      expect(isToolingOrTestPath('src/index.ts')).toBe(false)
      expect(isToolingOrTestPath('test/rules.test.ts')).toBe(true)
      expect(isToolingOrTestPath('scripts/check-dependency-whitelist.ts')).toBe(true)
    }),
  )
})

describe('§4.3: the clock is injected, never read from a global', () => {
  it.effect('REGRESSION: Date.now(), new Date() and performance.now() are all rejected', () =>
    Effect.sync(() => {
      const source = [
        'const a = Date.now()',
        'const b = new Date()',
        'const c = performance.now()',
      ].join('\n')

      const violations = findBannedTimeSources(source, SHIPPED)
      expect(violations.map((violation) => violation.line)).toStrictEqual([1, 2, 3])
      expect(violations.every((violation) => violation.rule === 'banned-time-source')).toBe(true)
    }),
  )

  it.effect('a mention of Date.now() inside a comment or a string is not a violation', () =>
    Effect.sync(() => {
      const source = ['// Date.now() is banned', "const message = 'Date.now()'"].join('\n')
      expect(findBannedTimeSources(source, SHIPPED)).toStrictEqual([])
    }),
  )
})

describe('the roster, read from the seat of another repository', () => {
  it.effect('REGRESSION: seated in mx-ui, importing mx-gameplay is rejected — the zero-edge rule is symmetric', () =>
    Effect.sync(() => {
      const violation = classifyImport(
        {
          importedPackage: '@nerima-games/mx-gameplay',
          filePath: SHIPPED,
          line: 1,
          isToolingOrTest: false,
        },
        declared(['@nerima-games/mx-gameplay']),
        seatOf('@nerima-games/mx-ui'),
      )
      expect(violation?.rule).toBe('not-whitelisted')
    }),
  )

  it.effect('mc-compose IS allowed to import mx-gameplay — it is the one repository that may', () =>
    Effect.sync(() => {
      expect(
        classifyImport(
          {
            importedPackage: '@nerima-games/mx-gameplay',
            filePath: SHIPPED,
            line: 1,
            isToolingOrTest: false,
          },
          declared(['@nerima-games/mx-gameplay']),
          seatOf('@nerima-games/mc-compose'),
        ),
      ).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: mc-compose may not reach past its four children to mc-sim', () =>
    Effect.sync(() => {
      // The composition layer is where the reference accumulated 13k LOC of
      // rules (plan.md §3.15). Denying it the foundation repositories is what
      // keeps 「composeの追加コードはLayer合成とstage順序表だけ」 enforceable.
      const violation = classifyImport(
        {
          importedPackage: '@nerima-games/mc-sim',
          filePath: SHIPPED,
          line: 1,
          isToolingOrTest: false,
        },
        declared(['@nerima-games/mc-sim']),
        seatOf('@nerima-games/mc-compose'),
      )
      expect(violation?.rule).toBe('transitive-import')
    }),
  )
})

// ---------------------------------------------------------------------------
// What the gate calls "shipped" and what npm actually ships must be one set.
//
// These are two hand-maintained lists describing the same thing that could not
// see each other, and both halves have now gone wrong in this organisation, in
// opposite directions:
//
//   - mx-multiplayer had `stages` in SCAN_ROOTS but NOT in isToolingOrTestPath,
//     so its first stage registration would have been classified as tooling --
//     and tooling may import a devDependency. That is rule 6, the same hole
//     that left the shipped build with no input stage at all.
//   - mc-render had the mirror image: `stages/` was correctly shipped source to
//     the gate, and `files` omitted it, so `npm publish` would have produced a
//     package with none of its five stage registrations in it.
//
// Neither is visible from inside its own half, and this repository is correct
// today -- which is exactly when to pin it, because the hole opens on the day
// someone adds the next root.
// ---------------------------------------------------------------------------
describe('the published package and the dependency gate agree on what ships', () => {
  it.effect('every shipped source root the gate scans is in package.json `files`', () =>
    Effect.sync(() => {
      const shipped = SCAN_ROOTS.filter((root) => !isToolingOrTestPath(`${root}/probe.ts`))
      const files: ReadonlyArray<string> = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      ).files

      const missing = shipped.filter(
        (root) => !files.some((publishedRoot) => root === publishedRoot || root.startsWith(`${publishedRoot}/`)),
      )
      expect(missing, `these roots ship code but npm would not include them: ${missing.join(', ')}`).toStrictEqual([])
    }),
  )
})
