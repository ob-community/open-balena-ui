# Host OS and Supervisor updates

Open Balena Admin can discover public Host OS and Supervisor releases, copy the metadata required by open-balena-api
into the local installation, and assign those local releases to devices. Synchronization copies metadata only. It does
not copy image blobs. On open-balena-api v46.1.0 and newer, it also persists the small `device-type.json` documents
needed for local device configuration generation.

## Required UI server configuration

Configure these variables on the Open Balena Admin server:

| Variable                              | Purpose                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_OPEN_BALENA_API_URL`       | Base URL of the local open-balena-api installation.                                                                                                                                                                                   |
| `REACT_APP_OPEN_BALENA_API_VERSION`   | Installed open-balena-api software version. Used to select compatible fields and behavior.                                                                                                                                            |
| `REACT_APP_OPEN_BALENA_ODATA_VERSION` | Optional `v6` or `v7` endpoint override. Normally omit it.                                                                                                                                                                            |
| `OPEN_BALENA_OS_CATALOG_API_URL`      | Public source catalog API. Defaults to `https://api.balena-cloud.com`.                                                                                                                                                                |
| `OPEN_BALENA_OS_REGISTRY_HOST`        | Registry hostname stored in synchronized image records. See the delivery options below.                                                                                                                                               |
| `CONTRACT_ALLOWLIST`                  | Mirror the API's semicolon-separated contract allowlist. Only `hw.device-type/<slug>` entries restrict device types; architecture entries do not. Empty or architecture-only means all local types, matching the API metadata loader. |
| `OPEN_BALENA_OS_METADATA_BUCKET`      | Required for Host OS sync on API v46.1+. Private, pre-provisioned S3-compatible bucket for device metadata.                                                                                                                           |
| `OPEN_BALENA_OS_METADATA_URL`         | Stable UI base URL reachable from ob-api. Defaults to `REACT_APP_OPEN_BALENA_UI_URL`.                                                                                                                                                 |
| `OPEN_BALENA_OS_METADATA_SOURCE_URL`  | Public metadata source used during sync. Defaults to `https://resin-production-img-cloudformation.s3.amazonaws.com/images`.                                                                                                           |
| `OPEN_BALENA_S3_URL`                  | S3-compatible endpoint (SeaweedFS S3 gateway, MinIO, or AWS S3) used by the UI's storage client.                                                                                                                                      |
| `OPEN_BALENA_S3_ACCESS_KEY`           | UI server storage credential with read/write access to the metadata bucket.                                                                                                                                                           |
| `OPEN_BALENA_S3_SECRET_KEY`           | UI server storage secret. Never exposed to browsers or included in asset URLs.                                                                                                                                                        |
| `OPEN_BALENA_S3_REGION`               | S3 region. Defaults to `us-east-1`.                                                                                                                                                                                                   |

The UI server must be able to reach the local open-balena-api and the configured public catalog API. A browser does not
perform catalog writes directly.

### Local metadata storage deployment

Provision a private bucket such as `balena-os-metadata` in the S3-compatible backend and grant the UI's storage identity
`GetObject` and `PutObject` access to it. Do not make the bucket public. Configure the variables above on the UI
deployment; this repository does not contain the installation's Helm/Pulumi manifests. For chart-managed installations,
private buckets, credentials, and the automated, idempotent MinIO-to-SeaweedFS data migration are managed entirely by
the infrastructure chart. Operators do not run manual migration commands or a UI-side migration script. Follow the
installation's infrastructure chart deployment guide for rollout and migration verification. Keep existing bucket names
and object keys, storage authorization, and the published metadata URLs intact when switching backends; MinIO remains
supported.

The UI uses a shared AWS SDK v3 client with `forcePathStyle: true`. `OPEN_BALENA_S3_URL` must point to the authenticated
S3 gateway, not the SeaweedFS filer API. The same backend-neutral environment variables and region setting apply to both
SeaweedFS and MinIO. Its storage operations are:

- Registry inventory: `ListObjectsV2` with prefixes, `/` delimiter for repository discovery, and continuation tokens. An
  incomplete/cycling pagination response fails the operation rather than silently hiding objects.
- Registry cleanup: `DeleteObjects`, in batches of at most 1000 keys with `Quiet: true`. Per-object errors and backend
  failures are reported, not treated as successful cleanup. The UI identity needs list/delete access to the registry
  bucket.
- Device-type metadata: `PutObject` with JSON content, `If-None-Match: *`, and a SHA-256 content-addressed key;
  `GetObject` for bounded, independently SHA-256-verified reads. An already-existing object (HTTP 412) is read and
  checked before reuse. A backend that rejects conditional writes causes sync to fail explicitly; there is no
  unconditional-write fallback.

These operations require compatible pagination, conditional-write, multi-delete, and SDK checksum behavior from the
deployed S3 gateway. Changing providers does not disable metadata integrity checks or relax private bucket policies.

The UI stores content-addressed JSON objects and serves them through a read-only endpoint:

```text
GET /balena-os/device-types/<slug>/<version>/<sha256>/device-type.json
```

This endpoint intentionally needs no authorization header: the API's asset reader sends none, and device-type metadata
is already public. It exposes only validated metadata objects, not bucket listings, credentials, device configs, or
write operations. Other BalenaOS routes retain their existing administrator authorization. The UI origin must route this
path to the server, without a login redirect or an access challenge for ob-api. Private bucket objects survive UI
restarts and are shared across replicas; keep the published UI origin stable. `OPEN_BALENA_OS_METADATA_URL` can be an
internal UI origin reachable only by ob-api. These metadata URLs are read server-side for config generation and are
never sent to devices in normal balenaOS provisioning or target-state responses. Device provisioning downloads and
registry image pulls use separate endpoints; devices do not need access to the internal UI metadata origin.

Release assets are written as ordinary OData WebResource references (`filename`, `href`, `content_type`, `size`,
`checksum`). Because the UI owns storage and delivery, **ob-api does not need `WEBRESOURCES_S3_*` settings or a modified
image for this implementation**. This differs from uploading files through ob-api's multipart-upload handler.

## Desired and reported device state

Host OS and Supervisor updates use separate desired and reported fields:

| Component  | Desired target                          | Device-reported state       |
| ---------- | --------------------------------------- | --------------------------- |
| Host OS    | `device.should_be_operated_by__release` | `device.os_version`         |
| Supervisor | `device.should_be_managed_by__release`  | `device.supervisor_version` |

The UI writes only the desired release relationship. The device updates the reported version after it installs and
starts the target. While the values differ, the device summary shows `reported -> target`. When the device reports the
target version, the summary collapses to the new version.

Downgrades are not offered. open-balena-api also enforces Supervisor anti-rollback rules. Do not modify `os_version` or
`supervisor_version` to request an update; those are device-owned state fields.

## Local release records

The IDs returned by Balena Cloud cannot be assigned directly to a local device. Both target relationships are foreign
keys to the local open-balena-api `release` table. An assignable release therefore needs a local graph containing:

- an application;
- a release;
- its service or services;
- its image records; and
- its release-image relationships;
- Host OS image labels such as `io.balena.image.class=hostapp`, `io.balena.image.store=root`, and
  `io.balena.update.requires-reboot=1`;
- a local `balena_os/balenahup` updater application with a running release; and
- the Host OS application's `is_updated_by__application` relationship to that updater.

On API v46.1+ the synchronization also maintains a `release_asset` with `asset_key = 'device-type.json'` on the newest
successful, finalized, non-invalidated, non-ESR Host OS release selected by the API for each allowed local device type.
It repairs upstream asset references to point to our persisted copy. Metadata comes from the selected release's own
version, even if that release was already local and newer than the source releases imported in this run.
Rerunning synchronization backfills this asset on catalogs imported before metadata support was added, even when their
application/release graph is otherwise unchanged. It does not recreate those applications or releases. An identical
local asset is left unchanged on subsequent runs.

Open Balena Admin creates and updates the operational graph through open-balena-api. PostgREST verifies administrator
access and writes only the internal `application.is updated by-application` relation that public OData does not expose.
Host OS image labels are materialized from each public release's service composition. The corresponding Balena Cloud
`image_label` resource requires authenticated Cloud access, but the composition exposes the same metadata without
requiring Cloud credentials.
On open-balena-api v43.4.0 and newer, those application relationships cause device target state to include the private
updater image label required by the Helios `core-next` Host OS update planner. The legacy Supervisor intentionally
filters root Host OS payloads and therefore reports no application transitions for them; monitor `core-next` and the
`os-update` systemd unit when diagnosing Host OS updates.

### Host OS applications

Host OS applications use public source slugs such as `balena_os/generic-amd64`. The Services > BalenaOS page imports
selected Host OS releases into the required `balena_os` system organization. This preserves the public catalog slugs and
keeps Host OS and Supervisor metadata together. A Host OS target remains installation-wide and does not need to be in
the same organization as the device fleet. The synchronization action is disabled when `balena_os` does not exist.

### Supervisor applications and the `balena_os` organization

open-balena-api requires native Supervisor releases to belong to public, non-host applications with exact slugs such as:

- `balena_os/amd64-supervisor`;
- `balena_os/aarch64-supervisor`; or
- another architecture-specific Supervisor slug accepted by the installed open-balena-api version.

Because application slugs include their organization, the local installation must have an organization named exactly
`balena_os`. open-balena-api does not expose organization creation, so this administrative record must be provisioned
through the installation's deployment or protected direct-database bootstrap before a Supervisor target is selected. The
account used by the UI server must also be an organization member so open-balena-api permits catalog writes. The
supplied Mapped Pulumi deployment uses its idempotent `Org` resource, which adopts an existing organization by name and
ensures its authenticated bootstrap user is a member.

The Supervisor selector combines compatible local releases with Balena Cloud's public catalog. If the selected version
is not local, the UI server synchronizes that version's complete graph into the `balena_os` organization and then writes
the resulting local release ID to `device.should_be_managed_by__release`.

## Host OS catalog synchronization

Services > BalenaOS offers these scopes:

- **Latest + in use:** latest usable version per device type plus versions currently reported by devices.
- **Newer than version + in use:** versions newer than a threshold plus versions currently in use.
- **Only versions in use:** only versions currently reported by devices.
- **Single semantic version:** one requested version wherever it exists for a device type.
- **All catalog versions:** every usable release advertised by the version-appropriate public Host OS catalog.

Synchronization is additive and idempotent. It does not delete local releases or change device targets. The browser may
be closed after the server has accepted the job, but the UI server process must remain running because progress is held
in memory. The page polls status approximately every five seconds.

Invalidated releases are excluded from counts, latest-version decisions, and normal target choices. An invalidated
release is imported only when a matching device already reports it, and it remains invalidated locally. Selecting a
`+revN` release also imports required earlier non-invalidated revisions because open-balena-api assigns revisions
sequentially.

On API v46.1+, every Host OS scope additionally imports the latest usable standard Host OS release per allowed device
type, including its prerequisite revisions, to establish complete config-metadata coverage. Device targets are still
unchanged. The metadata coverage pass then reselects the newest eligible **local** release using the API's release
ordering and updates that release's asset. Older APIs and Supervisor-only synchronization keep their previous scopes.
Missing or ambiguous host applications, missing usable releases, invalid metadata, and storage failures fail the job
explicitly rather than reporting successful offline coverage.

All allowed device types need assets because ob-api loads their metadata together; one missing asset can trigger public
S3 fallback for the entire loader. Mirror `CONTRACT_ALLOWLIST` between the API and UI. Removing all device-type entries
does not mean deny-all: it means no device-type restriction, as in ob-api.
After the first successful sync, allow the API's metadata caches to refresh (local default five minutes, shared default
one hour); an already-pending lookup can also take time to finish. Verify `/device-types/v1/<slug>` and then gateway
creation. Subsequent config generation fetches persisted metadata from the UI, not public S3. OS image downloads and
registry pulls retain their existing delivery paths; this is not a fully offline OS-image mirror.

Before open-balena-api v46, usable Host OS versions are intersected with the installation's
`/device-types/v1/:deviceType/images` response. Starting with v46, that endpoint no longer exists, so the synchronizer
uses the standard public Host OS application's successful, finalized releases and excludes invalidated releases, ESR
applications, and ESR-style major versions of 2000 or newer. A `404` from the legacy endpoint triggers the same modern
behavior so a stale configured API version cannot break the catalog page.

On open-balena-api v0.139.0 through v0.148.x, the synchronizer uses final release types and `version` release tags.
Newer versions use native semantic release fields. See [API_VERSIONS.md](./API_VERSIONS.md) for all compatibility
boundaries.

## Image delivery options

`OPEN_BALENA_OS_REGISTRY_HOST` controls the hostname written into synchronized Host OS and Supervisor image records.
Choose one of the following models.

### Direct Balena Cloud image pulls

Set:

```text
OPEN_BALENA_OS_REGISTRY_HOST=registry2.balena-cloud.com
```

This is an intentional no-op rewrite: synchronized paths retain the public registry hostname. No local Host OS or
Supervisor proxy is required. Devices must be allowed to reach:

- `registry2.balena-cloud.com` for manifests;
- `api.balena-cloud.com` for anonymous registry tokens; and
- `registry-data.balena-cloud.com` for redirected blobs.

The installation still needs its normal private openBalena registry for user application images and locally built
releases.

### Local pull-through proxy

Use a local proxy when devices have hostname-restricted egress, when a single top-level domain is required, or when
local caching is desired. Set `OPEN_BALENA_OS_REGISTRY_HOST` to the externally reachable proxy hostname, for example:

```text
OPEN_BALENA_OS_REGISTRY_HOST=registry.example.com
```

The proxy must:

1. continue to serve and accept pushes for the private openBalena registry;
2. prefer private content for reads;
3. fall back to `registry2.balena-cloud.com` for missing public Host OS or Supervisor paths;
4. perform Balena Cloud's anonymous token exchange itself;
5. follow redirects to `registry-data.balena-cloud.com`;
6. avoid forwarding private device credentials or private registry authentication challenges to Balena Cloud; and
7. keep the public registry hostname hidden from devices when hostname filtering requires that behavior.

A plain Docker Distribution `proxy.remoteurl` setting is generally insufficient when one endpoint must support private
pushes and selective public fallback. Use an authentication-aware routing proxy in front of the private registry.

Registry rewriting happens when metadata is synchronized. After changing `OPEN_BALENA_OS_REGISTRY_HOST`, restart the UI
server and resynchronize affected releases so existing image records receive the new hostname.

## `/v6/supervisor_release` compatibility endpoint

Some openBalena deployments route `/v6/supervisor_release` through open-balena-helper and rewrite returned Supervisor
image hostnames. That endpoint remains useful to older Supervisor clients, but it does not create local native release
records and its public release IDs must not be assigned to `should_be_managed_by__release`.

The native target flow documented here synchronizes the local release graph first. If a deployment retains helper-level
hostname rewriting, configure it consistently with `OPEN_BALENA_OS_REGISTRY_HOST`; both paths should direct devices to
the same intended registry.

Deploy an open-balena-helper version that resolves `should_be_managed_by__release.raw_version` before falling back to
the device-reported `supervisor_version`. Older helper versions always queried Balena Cloud for the reported version, so
legacy `update-balena-supervisor` clients could keep receiving their current image even after open-balena-api accepted a
newer native target. The fallback preserves support for deployments and devices that do not have a desired Supervisor
release assigned.

## Supervisor system services

Supervisor 18.2.0 and newer may run system-level containers in addition to fleet application containers. Open Balena
Admin displays their image-install state in a separate **Supervisor** table below **App**. The system-service table has
the same status, release, and log-selection information as application services, but intentionally has no
start/stop/restart controls.

Supervisor 19 uses the `core`, `core-next`, and `service-relay` services while its implementation is migrated
incrementally. Their presence is expected and is not evidence that the synchronized release is malformed. See
[Supervisor improvements: laying the foundation](https://blog.balena.io/supervisor-improvements-laying-the-foundation/)
and the [service management documentation](https://docs.balena.io/learn/manage/services).

Balena Cloud supports direct upgrades from older Supervisors to Supervisor 19; Open Balena Admin therefore does not
require a Supervisor 18 stepping stone. If a direct upgrade leaves the old host `balena_supervisor` running while the
new system services repeatedly restart, investigate delivery ordering. In particular, the host updater must not treat a
system-service container that uses the target image as proof that the host Supervisor itself already runs that image.

## Queued Host OS updates

A Host OS target is persistent desired state, so it may be selected while a device is offline. Only one target is queued
at a time; selecting another replaces the previous target.

- Supervisor 19 and newer use `core-next` to pull the queued update, retry failures, and emit update logs without
  requiring Cloudlink.
- Older Supervisors require the API-side transitional implementation to notice the queued target and push it while the
  device is connected through Cloudlink. Merely storing the target is not sufficient unless that server-side mechanism
  is deployed.
- Retries may download the Host OS image more than once, which matters for metered connections.

See [Queued OS updates managed by the Supervisor](https://blog.balena.io/queued-os-updates-managed-by-the-supervisor/)
for the upstream behavior.

## Permissions and security

- Host OS catalog synchronization requires an Open Balena Admin global administrator.
- Device target writes remain subject to open-balena-api ACLs.
- The `balena_os` organization and membership for the administrative API identity must be provisioned during deployment.
  Creating its public application graph and setting a device target remain subject to open-balena-api permissions.
- Catalog and target writes never fall back from open-balena-api to direct database access.
- Never expose private registry credentials, device API keys, or authenticated private-registry challenges to Balena
  Cloud.

## Operational checks

Before assigning releases in production:

1. Confirm Services > BalenaOS can read the public catalog.
2. Synchronize a small scope such as **Latest + in use** or **Single semantic version**.
3. Verify the synchronized image hostname matches the chosen direct or proxy delivery model.
4. Pull an image that is absent from private storage from a representative device network.
5. Confirm the `balena_os` organization exists and the administrative API identity is a member.
6. Test application compatibility with the selected Host OS release.
7. Assign one test device and confirm the UI shows `reported -> target`.
8. If the device uses `/v6/supervisor_release`, confirm that endpoint resolves the desired rather than the reported
   Supervisor version.
9. Confirm the device reports the target and the transition display collapses after completion.

If assignment fails, check the UI server error first. Common causes are an inaccessible public catalog, missing
organization/application creation permission, an incompatible CPU architecture, an invalidated release, a registry
hostname that devices cannot resolve, or a proxy that cannot complete the public registry token exchange.
