# Releasing Nenu

Nenu uses curated GitHub Releases and Semantic Versioning. Releases are cut from `main` only. The
current `0.x` line is a public preview; backward-compatible features increment MINOR, fixes increment
PATCH, and operator-required migrations increment MAJOR.

## Before preparing a release

1. Confirm `main` is clean and current.
2. Review every change since the previous Nenu tag.
3. Choose the version based on operator impact.
4. Confirm compatibility and migration notes are complete.
5. Never use `git push --tags`: this fork contains inherited upstream tags that are not Nenu releases.

## Prepare the release commit

Update the same version in:

- `herdr-plugin.toml`
- `package.json`
- `web/package.json`
- the newest `## [X.Y.Z] - YYYY-MM-DD` entry in `CHANGELOG.md`

The changelog is curated for operators. Group changes under Added, Changed, Fixed, Security, or
Known limits. Describe behavior and migration requirements rather than listing commits.

Open a release PR and run:

```bash
bash scripts/check-version.sh
bun install --frozen-lockfile
bun run test
cd web && bun install --frozen-lockfile && bun run test && cd ..
bun run build
```

For UI or lifecycle changes, also verify the installed PWA and an update from the previous release on
the affected operating systems.

## Publish

Merge the release PR, pull the exact merge commit, and verify it is on `origin/main`. Then create and
push only the intended annotated tag:

```bash
git tag -a vX.Y.Z -m "Nenu vX.Y.Z" <release-commit>
git push origin vX.Y.Z
```

The Release workflow independently checks that the tag matches all manifests and the changelog,
that the commit belongs to `main`, and that tests and the production build pass. Only then does it
create the GitHub Release with the curated changelog section and update commands.

Because managed installations discover stable tags, the tag is itself distributable. Never tag an
unvalidated commit and never move or overwrite a published tag.

## Verify publication

```bash
gh release view vX.Y.Z --repo frizynn/nenu
herdr plugin install frizynn/nenu --ref vX.Y.Z --yes
herdr plugin action invoke version --plugin herdr.nenu
```

Confirm the release URL, source archives, displayed Nenu version, clean install, and update from the
previous supported release.

## Rollback

Do not rewrite the release or its tag. Publish a new patch release that reverts the faulty change.
For immediate operator recovery, reinstall the last known-good tag:

```bash
herdr plugin install frizynn/nenu --ref vPREVIOUS --yes
herdr plugin action invoke restart --plugin herdr.nenu
```

Document the failure and recovery in the patch release notes.
