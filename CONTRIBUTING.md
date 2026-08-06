# Contributing to @degliersa/raven-odm

Thank you for helping improve `@degliersa/raven-odm`. Contributions are welcome when they keep the library small, typed, validator-independent, and compatible with the official RavenDB Node.js client.

## Before opening an issue

- Search existing issues and pull requests first.
- Include the package version, Node.js version, RavenDB server version, and validator version when reporting a bug.
- For runtime bugs, include a minimal reproduction that does not contain credentials or private documents.
- Security reports must not be filed publicly. Contact the maintainers privately with reproduction steps and impact.

## Development setup

Requirements:

- Node.js 22 or newer
- npm
- Docker, for the RavenDB integration suite

Install dependencies from the project directory:

```bash
cd raven-odm
npm ci
```

Run the quality gates:

```bash
npm run lint
npm run typecheck
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
2. Explain the user-visible behavior and the reason for the change.
3. Add or update integration coverage for every new observable behavior.
4. Update `README.md`, `CONTRIBUTING.md`, or an example when the public workflow changes.
5. Run all quality gates locally and include the results in the pull request description.
6. Keep unrelated formatting or refactors out of the pull request.

Pull requests should be small enough to review as one coherent change. Reviewers may request changes when an API addition duplicates an existing path, weakens type safety, hides a RavenDB error, or lacks a real-server test.

## Changesets and releases

Every user-visible package change should include a Changeset:

```bash
npm run changeset
```

Select `@degliersa/raven-odm`, choose the appropriate semver bump, and describe the behavior in user-facing language. Do not edit generated versions or `CHANGELOG.md` manually. The release workflow versions and publishes packages from Changesets while the repository is in `alpha` prerelease mode.

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
