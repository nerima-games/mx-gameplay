{
  description = "mx-gameplay: Experience module for the nerima-games Minecraft-clone rebuild: the rules of play — mining and placement, item use, mob behaviour, drops, fluid propagation, vehicles, portals, day/night and weather.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
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
          # Node 22 matches the `engines` field and the CI runner. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint is the opposite case: it is NOT a package.json devDependency.
          # It used to be, and letting each repo pin its own oxlint version let
          # this repo silently drift onto oxlint 0.12.x, which does not
          # implement `no-restricted-imports` at all (the Tier dependency
          # policy's enforcement mechanism never actually ran). A single
          # pinned Nix-provided oxlint (nixpkgs currently ships 1.73.0) removes
          # that drift entirely: one version, declared once, for local dev and
          # CI alike.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.corepack_22
              pkgs.typescript-language-server
              pkgs.oxlint
            ];

            shellHook = ''
              corepack enable --install-directory "$PWD/.corepack" 2>/dev/null || true
              export PATH="$PWD/.corepack:$PATH"
            '';
          };
        }
      );
    };
}
