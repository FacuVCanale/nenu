# Contributing to Nenu

Thank you for helping improve Nenu. This project controls live terminal panes, so correctness,
privacy, and compatibility take priority over convenience.

## Before opening an issue

- Use [Discussions](https://github.com/frizynn/nenu/discussions) for setup and usage questions.
- Search [Issues](https://github.com/frizynn/nenu/issues) for an existing report.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).
- Remove usernames, hostnames, paths, tokens, pane output, and repository content from logs and images.

## Development setup

Requirements: Bun, Git, and Herdr 0.7.0 or newer. Tailscale is needed only for device testing through
the recommended private-network path.

```bash
git clone https://github.com/frizynn/nenu.git
cd nenu
bun install --frozen-lockfile
cd web && bun install --frozen-lockfile && cd ..
herdr plugin link "$(pwd)"
```

Run the bridge with `bun run dev`, or exercise the real service path with:

```bash
herdr plugin action invoke start --plugin herdr.nenu
```

The public name is Nenu, and so are the plugin id (`herdr.nenu`) and the service names since 1.0.
Internal identifiers such as `COLLIE_*`, `collie-ctl.sh`, storage keys and headers must remain
stable unless a migration is part of an explicitly planned major release
([ADR 0068](./.adr/0068-the-plugin-is-herdr-nenu-and-internal-names-stay.md)).

## Make a focused change

1. Create a branch from current `main`.
2. Add or update tests that prove material behavior.
3. Keep terminal fixtures byte-faithful. Never commit real secrets or private pane content.
4. Update stable documentation when behavior or operator steps change.
5. Add an ADR only for a durable decision that closes off an option contributors will reasonably
   propose again. See [.adr/README.md](.adr/README.md).

For new terminal-agent support, follow [HARNESS_CONTRIBUTING.md](HARNESS_CONTRIBUTING.md).

## Required checks

```bash
bun run typecheck
bun run test
cd web && bun run typecheck && bun run test && cd ..
bun run build
bash scripts/check-version.sh
```

UI changes should also be checked in real Chrome at a phone-sized viewport. Test iPhone safe areas,
keyboard opening, scrolling, drawers, and installed-PWA behavior when the change touches them.

## Versioning and changelog

Nenu follows Semantic Versioning. Maintainer release commits keep these four locations aligned:

- `herdr-plugin.toml`
- `package.json`
- `web/package.json`
- the newest release heading in `CHANGELOG.md`

External pull requests should normally leave versions and `CHANGELOG.md` unchanged; the maintainer
coordinates a release after compatible changes are merged. Describe the user-facing change in the PR
body so it can be included in release notes.

## Pull requests

Use a clear Conventional Commit title. Explain the problem, resulting behavior, validation, and
risk. Include current screenshots for visible UI changes. Keep unrelated refactors separate.

By contributing, you agree that your contribution is licensed under the repository's MIT License and
to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
