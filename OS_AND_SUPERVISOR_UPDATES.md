# Host OS and Supervisor updates

Open Balena Admin can discover public Host OS and Supervisor releases, copy the metadata required by open-balena-api
into the local installation, and assign those local releases to devices. Synchronization copies metadata only. It does
not copy image blobs.

## Required UI server configuration

Configure these variables on the Open Balena Admin server:

| Variable                              | Purpose                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `REACT_APP_OPEN_BALENA_API_URL`       | Base URL of the local open-balena-api installation.                                        |
| `REACT_APP_OPEN_BALENA_API_VERSION`   | Installed open-balena-api software version. Used to select compatible fields and behavior. |
| `REACT_APP_OPEN_BALENA_ODATA_VERSION` | Optional `v6` or `v7` endpoint override. Normally omit it.                                 |
| `OPEN_BALENA_OS_CATALOG_API_URL`      | Public source catalog API. Defaults to `https://api.balena-cloud.com`.                     |
| `OPEN_BALENA_OS_REGISTRY_HOST`        | Registry hostname stored in synchronized image records. See the delivery options below.    |

The UI server must be able to reach the local open-balena-api and the configured public catalog API. A browser does not
perform catalog writes directly.

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
- its release-image relationships.

Open Balena Admin creates and updates this graph through open-balena-api, not PostgREST. PostgREST is used only to
verify global-administrator access before an administrator starts a Host OS catalog synchronization.

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
