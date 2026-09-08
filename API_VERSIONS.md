# Supported open-balena-api versions

Open Balena Admin supports **open-balena-api v0.139.0 and newer**. Set `REACT_APP_OPEN_BALENA_API_VERSION` to the server
software version so the UI can select the correct resource and field names. `REACT_APP_OPEN_BALENA_ODATA_VERSION` is an
optional endpoint override and normally should be left unset.

The compatibility registry is implemented in `src/versions/index.ts`. Version thresholds inherit all mappings from the
previous threshold. Unknown versions newer than the newest threshold use the newest known mappings; versions below the
supported floor are clamped to v0.139.0 behavior but are not supported or tested.

## v25.2.8 and newer: native v7 model

- The provider uses the OData **v7** endpoint by default.
- Device target-release writes use `is pinned on-release`.
- V7 full-text and `@ilike` filters use `tolower(...)` for case-insensitive matching.
- Device-type aliases, application classes, release metadata, notes, and invalidation fields from all earlier thresholds
  remain available.
- Set `REACT_APP_OPEN_BALENA_ODATA_VERSION=v6` only when a deployment based on this software version does not expose v7.

## v0.185.0 through v25.2.7

- The provider uses the backwards-compatible OData **v6** endpoint.
- The `device type alias` resource is available. The UI registers its pages, references, create/delete workflow, and
  menu entry only at this boundary and newer.
- Device target release still uses the legacy `should be running-release` relation.
- Case-insensitive searches degrade to PineJS v6-compatible `contains(...)`; v6 does not receive the newer
  `tolower(...)` expression.

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
- Fleet create/edit forms show the class selector beginning at this boundary. Older servers omit the control entirely
  rather than sending an unsupported field.

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
- Application class, known-issue, note, invalidation, and device-type-alias functionality remain unavailable.

## v0.139.0 through v0.148.x: compatibility floor

- This is the oldest supported open-balena-api release.
- The provider uses OData **v6**.
- Legacy `{ "d": [...] }`, `{ "d": { "results": [...] } }`, and single-record response envelopes are accepted.
- Exact list totals use the legacy `/<resource>/$count` endpoint.
- `getMany` emits chained `id eq ... or id eq ...` expressions instead of the newer `in` operator.
- Multi-record updates/deletes execute one entity-key request per ID rather than using a destructive filtered mutation.
- Device target release is translated to `should be running-release`.
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
