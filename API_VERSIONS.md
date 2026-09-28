# Supported open-balena-api versions

Open Balena Admin supports **open-balena-api v0.139.0 and newer**. Set `REACT_APP_OPEN_BALENA_API_VERSION` to the server
software version so the UI can select the correct resource and field names. `REACT_APP_OPEN_BALENA_ODATA_VERSION` is an
optional endpoint override and normally should be left unset.

The compatibility registry is implemented in `src/versions/index.ts`. Version thresholds inherit all mappings from the
previous threshold. Unknown versions newer than the newest threshold use the newest known mappings; versions below the
supported floor are clamped to v0.139.0 behavior but are not supported or tested.

Administrator bootstrap does not install or call database functions. It uses the `user`, `role`, and `user-has-role`
PostgREST resources that are present at the v0.139.0 support floor.

Balena Cloud's device "Support access" control is not part of the open-balena-api model at any supported version. The
device summary marks it unavailable instead of attempting an unsupported or direct-database write.

The Services > BalenaOS synchronizer follows these same boundaries. On v0.149.0 and newer it writes semantic release
metadata through the computed `semver` field. On v0.139.0-v0.148.x it writes the legacy final `release_type` and a
`version` release tag instead; catalog statistics also read that tag because `raw_version` is unavailable. The
application `is_of__class` field is omitted before v0.157.3. Every version uses the configured v6/v7 endpoint and sends
all catalog writes through open-balena-api. Selective synchronization reads `device.os_version` and
`device.is_of__device_type` on every supported API generation to retain versions currently in use. Invalidated releases
are excluded from catalog counts, latest-version ordering, and ordinary selection at every version boundary. A matching
invalidated release is imported only when a device of that type already reports it, and its invalidated flag is
preserved so it cannot become a target for another device. Selective synchronization also imports earlier
non-invalidated revisions of a selected `+revN` release because open-balena-api assigns and validates release revisions
sequentially.

Host OS and Supervisor catalog applications are owned by the required `balena_os` system organization at every supported
version. Organization creation remains an administrative bootstrap operation because open-balena-api does not expose it;
the API identity used for synchronization must be an organization member.

## v26.1.0 and newer: native v7 model

- The provider uses the OData **v7** endpoint by default.
- This boundary follows open-balena-api [v26.1.0](https://github.com/balena-io/open-balena-api/releases/tag/v26.1.0),
  whose
  [`Release the v7 model`](https://github.com/balena-io/open-balena-api/commit/50da5cf46b2f090cf6df69946d2558c0766e2e57)
  change introduced the new model. It is independent of the v25.2.8 device pin-field migration.
- Device target-release writes use `is pinned on-release`.
- Device OS and supervisor upgrade choices use the configured v7 `release` endpoint with device-type and current
  semantic-version filters.
- The BalenaOS image catalog at `/device-types/v1/:deviceType/images` is not an assignable release catalog. It lists
  downloadable versions from image storage but does not create the host application, release, service, image, and
  related records required by `device.should_be_operated_by__release`. An installation with no local host applications
  therefore has no Host OS target choices even when that image endpoint lists many versions.
- Supervisor choices combine compatible local release records with Balena Cloud's public v7 release catalog by CPU
  architecture. Selecting a public-only version synchronizes its complete release graph through the configured
  open-balena-api under the `balena_os` system organization, then writes the resulting local ID to
  `device.should_be_managed_by__release`. Public release IDs are never written into the local relationship, and the UI
  never writes device-reported `device.supervisor_version`.
- Full-text and `@ilike` filters use `tolower(...)` for case-insensitive matching.
- Device-type aliases, application classes, release metadata, notes, and invalidation fields from all earlier thresholds
  remain available.
- Set `REACT_APP_OPEN_BALENA_ODATA_VERSION=v6` only when a deployment based on this software version does not expose v7.

## v25.2.8 through v26.0.x

- The provider continues to use the OData **v6** endpoint.
- Device target-release writes use `is pinned on-release`; the v7 model is not selected until v26.1.0.
- All capabilities from earlier thresholds remain available.

## v0.185.0 through v25.2.7

- The provider uses the backwards-compatible OData **v6** endpoint.
- The `device type alias` resource is available. The UI registers its pages, references, create/delete workflow, and
  menu entry only at this boundary and newer.
- Device target release still uses the legacy `should be running-release` relation.
- Case-insensitive searches use the PineJS-compatible `contains(tolower(...), ...)` expression on v6 and v7.

## v0.171.0 through v0.184.x

- Adds the release `invalidation reason` compatibility field (`invalidation_reason` over OData).
- Device-type alias UI and operations remain disabled because the resource is not yet available.

## v0.170.0 through v0.170.x

- Adds the release `note` compatibility field.
- Release invalidation reason remains unavailable.

## v0.158.0 through v0.169.x

- Adds the release `known issue list` compatibility field.
- Release notes and invalidation reason remain unavailable.

## v0.157.3 through v0.157.x

- Adds the application `is of-class` field.
- Fleet create/edit forms and class-dependent fleet/OS queries use this field beginning at this boundary. Older servers
  omit the control and class filters entirely rather than sending an unsupported field.

## v0.149.0 through v0.157.2

- Adds release finalization and semantic-version fields:
  - `is_finalized_at__date`
  - `semver_major`
  - `semver_minor`
  - `semver_patch`
  - `revision`
  - `is_final`
  - `semver`
- The UI's release version display tolerates records without these fields and falls back to available version data.
- Device OS upgrade choices use these fields to request only releases newer than the device's current OS.
- Application class, known-issue, note, invalidation, and device-type-alias functionality remain unavailable.

## v0.139.0 through v0.148.x: compatibility floor

- This is the oldest supported open-balena-api release.
- The provider uses OData **v6**.
- Legacy `{ "d": [...] }`, `{ "d": { "results": [...] } }`, and single-record response envelopes are accepted.
- Exact list totals use the legacy `/<resource>/$count` endpoint.
- `getMany` emits chained `id eq ... or id eq ...` expressions instead of the newer `in` operator.
- Multi-record updates/deletes execute one entity-key request per ID rather than using a destructive filtered mutation.
- Device target release is translated to `should be running-release`.
- Device OS and supervisor upgrade choices fall back to device-type-scoped applications and their `version` release tags
  because semantic-version fields are unavailable. Both selectors still require local release records whose IDs can be
  assigned to the device; image-catalog versions and unavailable entries from the global supervisor catalog are omitted.
- Application class and device-type aliases are hidden.
- Fields introduced by later release thresholds are treated as unavailable; forms do not send the fields that are
  explicitly version-gated.

## Direct database resources

API-version compatibility does not make open-balena-api expose all identity and authorization administration.
Administrator-only fallback resources are routed through the same-origin `/admin-db` proxy described in
`DIRECT_DB_ACCESS.md` and `ACCESS_CONTROLS.md`. They are not silently retried through PostgREST after an OData 401/403.

## Adding a boundary

When supporting a new API change:

1. Add a threshold to `src/versions/index.ts`, inheriting prior mappings.
2. Use `optionalField` or `optionalResource` when the feature did not exist on older servers.
3. Add unit coverage in `src/versions/index.test.ts`.
4. Add the new threshold at the top of this document.
5. Test the oldest supported v6 server and the current v7 server.
