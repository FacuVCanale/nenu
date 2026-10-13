## What and why

<!-- The problem, who hits it, and what changes for the operator. Link the issue: Closes #… -->

## Versions tested

<!-- Every one that applies. -->
- Nenu: <!-- `herdr plugin action invoke version --plugin herdr.nenu`, or the commit -->
- Herdr: <!-- `herdr --version` -->
- Host OS:
- Device and browser: <!-- e.g. iPhone 15, iOS 18.6, installed PWA; Chrome 141 on macOS -->

## How to reproduce and try it

<!-- Numbered steps a reviewer can follow. For a fix: the steps that failed before and pass now. -->
1.
2.
3.

## Evidence

<!-- Required for anything a person sees or does. Remove private data first. -->
- Fix of something visible: screenshots **before and after**, same screen and size.
- New feature or interaction (gesture, flow, animation, notification): a **short screen recording**
  of the whole flow on a phone-sized screen.
- Bridge or script only: the command you ran and its relevant output, or the test that proves it.

## Validation

<!-- Checks run (typecheck, tests, build) and where you tried it for real. -->

## Risk and rollback

<!-- Compatibility, security, migration, and how to undo it. -->

## Checklist

- [ ] The change is focused and contains no private pane output, credentials, or personal paths.
- [ ] Versions tested, reproduction steps and evidence are filled in above.
- [ ] Typechecks, relevant tests, and the production build pass.
- [ ] User-facing behavior and stable docs agree.
- [ ] Compatibility identifiers remain stable, or the migration is documented as a major change.
- [ ] Security-sensitive behavior has meaningful regression coverage.
