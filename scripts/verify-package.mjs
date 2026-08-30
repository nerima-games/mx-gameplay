import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const packageName = manifest.name;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const typeScriptCompiler = join(
  root,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

const commandLabel = (command, args) => `${command} ${args.join(" ")}`;

const run = (
  command,
  args,
  { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, ...options } = {},
) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    ...options,
  });
  if (result.error) {
    throw new Error(
      `${commandLabel(command, args)} failed: ${result.error.message}`,
    );
  }
  if (result.signal) {
    throw new Error(
      `${commandLabel(command, args)} terminated by ${result.signal}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${commandLabel(command, args)} exited with status ${result.status}`,
    );
  }
  return result;
};

const capture = (
  command,
  args,
  { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, ...options } = {},
) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    ...options,
  });
  if (result.error) {
    throw new Error(
      `${commandLabel(command, args)} failed: ${result.error.message}`,
    );
  }
  if (result.signal) {
    throw new Error(
      `${commandLabel(command, args)} terminated by ${result.signal}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${commandLabel(command, args)} exited with status ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
};

// mx-gameplay declares a single export (docs/public-api.md §1: the only
// contract is the `StageRegistration` array via `makeGameplayStages`), unlike
// mc-kernel's per-domain subpaths. There is therefore no domain-entrypoint
// mirroring section here — see the hard rule against adding `exports`
// subpaths that docs/public-api.md does not declare as contract.
const exportEntries = Object.entries(manifest.exports ?? {});
if (exportEntries.length === 0) {
  throw new Error("package.json must declare at least one export");
}
if (!("." in manifest.exports)) {
  throw new Error("package.json exports must include the root entry \".\"");
}

const targetPaths = new Set();
for (const [subpath, target] of exportEntries) {
  if (typeof target === "string") {
    targetPaths.add(target);
    continue;
  }
  if (typeof target !== "object" || target === null) {
    throw new Error(`Unsupported export declaration for ${subpath}`);
  }
  for (const field of ["types", "import", "default"]) {
    if (typeof target[field] === "string") {
      targetPaths.add(target[field]);
    }
  }
}

if (targetPaths.size === 0) {
  throw new Error("package.json exports do not contain any target paths");
}

const archiveEntryFor = (targetPath) =>
  `package/${targetPath.replace(/^\.\//, "")}`;
const peerDependencies = manifest.peerDependencies ?? {};

const workspace = await mkdtemp(join(tmpdir(), "mx-gameplay-package-"));
const packDirectory = join(workspace, "pack");
const consumerDirectory = join(workspace, "consumer");
await mkdir(packDirectory);
await mkdir(consumerDirectory);

try {
  run("pnpm", ["pack", "--pack-destination", packDirectory], {
    timeoutMs: 60_000,
  });

  const archives = (await readdir(packDirectory)).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  if (archives.length !== 1) {
    throw new Error(
      `Expected exactly one package archive, found ${archives.length}`,
    );
  }

  const archivePath = join(packDirectory, archives[0]);
  const archiveStat = await stat(archivePath);
  if (archiveStat.size === 0) {
    throw new Error("Package archive is empty");
  }

  const archiveEntries = new Set(
    capture("tar", ["-tzf", archivePath], { cwd: root, timeoutMs: 30_000 })
      .trim()
      .split("\n")
      .filter(Boolean),
  );
  for (const targetPath of targetPaths) {
    const archiveEntry = archiveEntryFor(targetPath);
    if (!archiveEntries.has(archiveEntry)) {
      throw new Error(
        `Package archive is missing export target ${archiveEntry}`,
      );
    }
  }

  // Addendum 3 (org decision, 2026-08-30 14:15 JST): `@nerima-games/*`
  // siblings resolve from GitHub Packages, and a plain `npm install` in a
  // clean consumer directory carries no token. Write an `.npmrc` that reads
  // NODE_AUTH_TOKEN the way pnpm's own user config does; the literal
  // `${NODE_AUTH_TOKEN}` placeholder is expanded by npm at install time, so
  // the token value itself is never written to disk here.
  await writeFile(
    join(consumerDirectory, ".npmrc"),
    "@nerima-games:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n",
  );

  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "mx-gameplay-package-consumer",
        private: true,
        type: "module",
        dependencies: peerDependencies,
      },
      null,
      2,
    )}\n`,
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archivePath],
    {
      cwd: consumerDirectory,
      timeoutMs: 180_000,
      env: { ...process.env, NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN ?? "" },
    },
  );

  // Runtime probe: exercise the contract entries docs/public-api.md §5 names,
  // plus a couple of the internal(visible) exports test/public-api.test.ts
  // already pins, so a packed-and-installed archive is checked against the
  // same behaviour the source tests check.
  const probe = `
    const packageName = ${JSON.stringify(packageName)};
    const rootModule = await import(packageName);
    if (Object.keys(rootModule).length === 0) {
      throw new Error('The root export has no runtime exports');
    }
    if (rootModule.makeGameplayStages === undefined) {
      throw new Error('The root export does not expose makeGameplayStages');
    }
    if (typeof rootModule.gameplayModule !== 'object' || rootModule.gameplayModule === null) {
      throw new Error('The root export does not expose gameplayModule');
    }
    if (typeof rootModule.gameplayModule.frameStages === 'undefined') {
      throw new Error('gameplayModule does not expose frameStages');
    }
    if (typeof rootModule.GAMEPLAY_STAGE_IDS !== 'object' || rootModule.GAMEPLAY_STAGE_IDS === null) {
      throw new Error('The root export does not expose GAMEPLAY_STAGE_IDS');
    }
    if (
      typeof rootModule.blockOfPlaceableItem !== 'function' ||
      typeof rootModule.itemOfBlock !== 'function' ||
      typeof rootModule.isPlaceableItem !== 'function'
    ) {
      throw new Error('The root export does not expose the block-vocabulary bridge');
    }
    if (rootModule.blockOfPlaceableItem('redstone_dust') !== 'redstone_wire') {
      throw new Error('The root export returned an invalid blockOfPlaceableItem result');
    }
    if (rootModule.itemOfBlock('redstone_wire') !== 'redstone_dust') {
      throw new Error('The root export returned an invalid itemOfBlock result');
    }
    if (rootModule.isPlaceableItem('redstone_dust') !== true) {
      throw new Error('The root export returned an invalid isPlaceableItem result');
    }
    if (typeof rootModule.spawnDroppedItem !== 'function' || typeof rootModule.spawnDroppedItems !== 'function') {
      throw new Error('The root export does not expose dropped-item spawning');
    }
    if (typeof rootModule.planFallingBlockMoves !== 'function') {
      throw new Error('The root export does not expose planFallingBlockMoves');
    }
    console.log('verified ' + packageName + ' exports');
  `;
  run("node", ["--input-type=module", "--eval", probe], {
    cwd: consumerDirectory,
    timeoutMs: 30_000,
  });

  const typeConsumerSource = `
import {
  blockOfPlaceableItem,
  itemOfBlock,
  isPlaceableItem,
  makeGameplayStages,
  gameplayModule,
  GAMEPLAY_STAGE_IDS,
  type PlaceableItemType,
} from ${JSON.stringify(packageName)}

const item: PlaceableItemType = 'redstone_dust'
const block = blockOfPlaceableItem(item)
const roundTrip = itemOfBlock(block)
const placeable = isPlaceableItem(item)

if (block !== 'redstone_wire' || roundTrip !== 'redstone_dust' || placeable !== true) {
  throw new Error('Block-vocabulary declaration consumer returned an invalid result')
}

const declaredStageOrder: ReadonlyArray<string> = Object.values(GAMEPLAY_STAGE_IDS)
if (declaredStageOrder.length === 0) {
  throw new Error('GAMEPLAY_STAGE_IDS declaration consumer returned no stage ids')
}

void makeGameplayStages
void gameplayModule
`;
  if (typeConsumerSource.trim().length === 0) {
    throw new Error("TypeScript consumer source must not be empty");
  }
  await writeFile(
    join(consumerDirectory, "consumer.ts"),
    typeConsumerSource.trimStart(),
  );
  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run(
    process.execPath,
    [
      typeScriptCompiler,
      "--project",
      join(consumerDirectory, "tsconfig.json"),
      "--pretty",
      "false",
    ],
    { cwd: consumerDirectory, timeoutMs: 30_000 },
  );
  console.log(`verified ${packageName} declaration consumer typecheck`);

  console.log(`verified package archive ${relative(root, archivePath)}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
