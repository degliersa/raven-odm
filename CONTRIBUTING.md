# Contributing to @degliersa/raven-odm

Thank you for helping improve `@degliersa/raven-odm`. Contributions are welcome when they keep the library small, typed, validator-independent, and compatible with the official RavenDB Node.js client.

## Before opening an issue

- Search existing issues and pull requests first.
- Use the bug report or feature request template; both ask for what a useful report needs (versions, minimal reproduction, or motivation and proposed shape).
- Security reports must not be filed publicly. Contact the maintainers privately with reproduction steps and impact.

## Design proposals

Any change to the public API, to the `RavenOdmError` contract, or to any other documented, observable behavior — not just breaking changes — starts with a short issue, not a PR. Open one with the "Design proposal" template: state the motivation, sketch the proposed shape, note alternatives you considered, and call out the compatibility impact.

There is no formal review period or sign-off quorum here — this is sized for a project with one maintainer. The point is only to write the why before the how, so a design that turns out to be wrong is caught before code gets written around it.

When the proposal is resolved, comment on the issue with the decision — accepted as proposed, accepted with changes, rejected, or deferred — and why. That comment is the design record: it stays discoverable on the issue instead of scattered across PR descriptions that scroll out of relevance. The implementing PR references the issue with "Closes #"; it does not need to happen in the same sitting as the proposal.

## Development setup

Requirements:

- Node.js 22 or newer
- npm
- Docker, for the RavenDB integration suite

Install dependencies from the repository root:

```bash
npm ci
```

Run the quality gates:

```bash
npm run lint
npm run typecheck
npm run typecheck:examples
npm run build
npm test
npm run check:pack
```

The tests use `RAVENDB_URL` when it is set. Without that variable, Vitest starts `ravendb/ravendb:latest` on port 8099 and removes only the container it started. To use an existing server:

```bash
RAVENDB_URL=http://127.0.0.1:8099 npm test
```

## Design principles

- Keep the public API typed under strict TypeScript settings, including `exactOptionalPropertyTypes`.
- Use Standard Schema interfaces instead of coupling core code to Zod, Valibot, ArkType, Yup, or another validator.
- Preserve exact collection names; never add implicit pluralization.
- Validate before writes and keep documents schema-valid after updates.
- Normalize RavenDB failures into the documented `RavenOdmError` codes.
- Prefer a direct implementation over a new abstraction when the abstraction does not protect a public contract.
- Keep returned documents as flat validated copies. They are not tracked RavenDB entities.

## Pull requests

1. Create a focused branch from `main`.
2. If the change touches public API or observable behavior, link the design-proposal issue it implements.
3. Explain the user-visible behavior and the reason for the change.
4. Add or update integration coverage for every new observable behavior.
5. Update `README.md`, `CONTRIBUTING.md`, or an example when the public workflow changes.
6. Run all quality gates locally and include the results in the pull request description.
7. Keep unrelated formatting or refactors out of the pull request.

The pull request template's checklist mirrors this list. Pull requests should be small enough to review as one coherent change. Reviewers may request changes when an API addition duplicates an existing path, weakens type safety, hides a RavenDB error, or lacks a real-server test.

## Roadmap

Issue #29 tracks the prioritized backlog with an ICE (Impact/Confidence/Ease) score per item. At each minor or major release, add a dated header to that issue — "Snapshot: <Month Year>" — recording what shipped, what got reprioritized, and what was deferred, so the backlog's history stays visible instead of only reflecting its current state.

## Changesets and releases

Every user-visible package change should include a Changeset:

```bash
npm run changeset
```

Select `@degliersa/raven-odm`, choose the appropriate semver bump, and describe the behavior in user-facing language. Do not edit generated versions or `CHANGELOG.md` manually. The release workflow versions and publishes packages from Changesets while the repository is in `alpha` prerelease mode.

The npm package is published through npm Trusted Publishing. Configure the package's trusted publisher for GitHub Actions with user or organization `degliersa`, repository `raven-odm`, and workflow filename `release.yml`; no `NPM_TOKEN` secret is required.

Documentation-only changes and test-only changes normally do not need a Changeset unless they alter the published package or its supported workflow.

## Commit guidance

Use imperative, focused commit messages such as:

```text
feat: add server identity strategy
fix: normalize optimistic concurrency errors
test: cover valibot schemas
docs: clarify external sessions
ci: update release workflow
```

Do not commit `node_modules`, `dist`, coverage output, local `.env` files, or generated tarballs.

## Code of conduct

Be respectful, specific, and constructive. Assume good intent, focus criticism on the code or proposal, and make room for contributors with different experience levels. Harassment, discrimination, personal attacks, and knowingly disruptive behavior are not accepted.
