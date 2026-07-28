# CI/CD and release policy

The client, rendezvous/relay server, and API server are independently
versioned products. A client release never infers its version from either
server, and a server release never advances the client version.

## Validation events

| Event | Required behavior |
|---|---|
| Pull request | Classify paths, validate the component version, and run full quality gates for runtime changes. Superseded runs are cancelled. |
| Dependency pull request | Run the normal runtime gates plus dependency-graph review and ecosystem audits. |
| Default-branch push | Run the same trusted CI and retain its bridge artifact as release evidence. Runs are not cancelled. |
| Documentation-only change | Run classification, version validation, and the stable `CI / Required` gate without expensive compilers. |
| Weekly schedule | Re-audit the locked Rust dependency graph for newly disclosed advisories. |
| Manual release | Build only from a default-branch-reachable commit with a successful push CI run; do not repeat quality tests. |

Branch protection should require the single stable `CI / Required` check.
Individual job names may evolve without changing that merge contract.

## Client version

The canonical client release metadata is:

- `Cargo.toml` package version;
- the `rustdesk` package entry in `Cargo.lock`;
- `src/version.rs` `VERSION`;
- `flutter/pubspec.yaml` `MAJOR.MINOR.PATCH+BUILD_NUMBER`.

All four values must agree. The build number is explicit and positive; it is
not derived from Git commit count. Only stable SemVer is accepted for a
production release, and the canonical tag is `vMAJOR.MINOR.PATCH`.

Validate metadata locally with:

```bash
python3 .github/scripts/release_metadata.py
python3 -m unittest discover -s .github/scripts/tests -v
```

When changing a version for a local build, pass both values explicitly:

```bash
python3 build.py web --version 1.5.0 --build-number 68
```

## Release flow

1. Merge a reviewed version-change pull request and wait for its push `CI`.
2. Manually dispatch `Release`, leaving `source_ref` blank for the current
   default branch or supplying an exact reachable commit.
3. Keep `publish=false` for a full build-only rehearsal. Select at least one
   platform.
4. For production, set `publish=true` and approve the `release` environment.
   The workflow rejects both legacy unprefixed and canonical tags for an
   already released version.
5. Platform jobs download the generated bridge from that exact successful CI
   run. They build release packages but do not rerun Rust, Flutter, or Web
   quality tests.
6. Only after every selected build succeeds does the workflow create the tag,
   checksums, provenance attestations, version manifest, and GitHub Release.

`RS_PUB_KEY` is a repository secret. `RENDEZVOUS_SERVERS` and `API_SERVER` are
repository variables, with same-named secrets retained as a compatibility
fallback. Dispatch inputs never carry production configuration or secrets.

The client and server repositories must continue to pin the exact same
`libs/hbb_common` gitlink. Its commit is recorded in each release manifest and
must be checked across both repositories before merging a submodule update.

## Web consumer contract

The API server pins one immutable client commit in `web-client.lock`. Its CI
checks out a repository under the same GitHub owner, using the configurable
repository name that defaults to `rustdesk`, builds or restores the Web
runtime, and synchronizes the generated artifact. The API repository does not
track `static/web_client`, so ordinary local development does not retain a
generated Web build. Renaming this client repository only requires changing
the API repository variable `RUSTDESK_REPOSITORY_NAME`; owner-qualified and
cross-account values are rejected.
