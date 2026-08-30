{
  description = "mx-gameplay: Experience module for the nerima-games Minecraft-clone rebuild: the rules of play — mining and placement, item use, mob behaviour, drops, fluid propagation, vehicles, portals, day/night and weather.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    #
    # Locked (not `nix flake update`) to a pre-1.79.0-oxlint commit: nixos-unstable's
    # current oxlint 1.79.0 misfires `no-redeclare` on the `type X … & Brand` +
    # `const X = Brand.refined` idiom used throughout this repository's domain
    # types (A/B-proven against 1.75.0, which is clean). Re-check on the next bump.
    nixpkgs.url = "github:NixOS/nixpkgs/624af665418d3c65d544145b4d34ad696439570e";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # Only what is actually exercised: x86_64-linux by CI, aarch64-darwin by
      # the maintainer. Declaring a platform nothing builds makes
      # `nix flake check --all-systems` fail rather than skip it.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # Node 24 matches the `engines` field and the CI runner. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint and ast-grep are NOT package.json devDependencies. Letting
          # each repo pin its own oxlint version let this repo silently drift
          # onto oxlint 0.12.x, which does not implement `no-restricted-imports`
          # at all (the Tier dependency policy's enforcement mechanism never
          # actually ran). A single pinned Nix-provided oxlint removes that
          # drift entirely: one version, declared once, for local dev and CI
          # alike.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.corepack_24
              pkgs.typescript-language-server
              pkgs.oxlint
              pkgs.ast-grep
            ];

            shellHook = ''
              corepackDir="$(mktemp -d "''${TMPDIR:-/tmp}/mx-gameplay-corepack.XXXXXX")"
              corepack enable --install-directory "$corepackDir"
              export PATH="$corepackDir:$PATH"
            '';
          };
        }
      );
    };
}
