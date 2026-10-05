# User Interface for Open Balena Admin

User interface for [open-balena-admin](https://github.com/ob-community/open-balena-admin), an admin interface for
open-balena.

## Documentation

- [Access controls](ACCESS_CONTROLS.md) explains Legacy and RBAC modes, administrator roles, organization scope, and
  credential protections.
- [API versions](API_VERSIONS.md) documents the supported open-balena-api versions and compatibility behavior.
- [Direct database access](DIRECT_DB_ACCESS.md) explains which resources require protected PostgREST access and why.
- [Host OS and Supervisor updates](OS_AND_SUPERVISOR_UPDATES.md) covers catalog synchronization, image delivery, update
  behavior, and deployment requirements.
- [Built-in remote access](REMOTE_ACCESS_ARCHITECTURE.md) documents browser terminals, tunnel and SSH authentication,
  ephemeral key lifecycle, streaming SFTP transfers, trust boundaries, configuration, and operations.

## Device refresh behavior

- Device lists (including dashboard device cards) refresh every 30 seconds. Visible rows reporting configuration or
  deployment activity refresh in batched requests approximately every second, without refetching the entire list or
  changing its membership, ordering, or pagination. Offscreen rows do not start fast polling.
- A device's show page refreshes device state and service installation state every 30 seconds when steady. It switches
  to approximately one-second polling when the device reports an ongoing operation, including on initial page load, or
  when its effective Host OS, Supervisor, or application target has not yet been reached.
- Editing those targets or starting, stopping, or restarting a container immediately enables fast polling. An accepted
  request remains tracked until fresh, post-acknowledgment state shows completion, failure, or a superseding target; an
  unchanged pre-request snapshot cannot complete it. Failed requests stop being tracked. Queued changes remain pending
  until the device reports an outcome; polling does not invent a timeout or cancel device operations.
- The show page shares its device and installation queries across the summary and service widgets instead of running
  independent timers. Immutable release metadata is cached separately; fleet/latest-release discovery remains on a
  30-second cadence. Historical installations from unrelated releases do not keep a settled device polling rapidly.
- Periodic device polling runs only while the browser page is in the foreground. Log polling remains independent at
  approximately two seconds while sources are selected; device refreshes do not reconnect SSH terminals.

## Dependencies

This project uses `open-balena-api` for operational data and depends on
[open-balena-postgrest](https://github.com/ob-community/open-balena-postgrest) for administrator identity and
authorization resources that the API does not expose with the required global semantics, plus narrowly scoped
server-only Host OS metadata writes that public OData cannot perform. Device terminals and file transfers are built in
when `REACT_APP_OPEN_BALENA_REMOTE_URL` is unset. Configuring that variable retains compatibility with
[open-balena-remote](https://github.com/ob-community/open-balena-remote). See [DIRECT_DB_ACCESS.md](DIRECT_DB_ACCESS.md)
for the security and deployment implications of the hybrid provider and
[REMOTE_ACCESS_ARCHITECTURE.md](REMOTE_ACCESS_ARCHITECTURE.md) for the complete remote-access deployment model.

## Configuration

There are a number of environment variables used to configure the ui:

- `PORT` - The port that the ui will listen on

- `OPEN_BALENA_POSTGREST_URL` The internal URL (accessible to the UI server, not browsers) of the
  `open-balena-postgrest` instance, i.e. `http://postgrest.openbalena.local:8000`. It must point directly to a PostgREST
  endpoint that returns JSON, not to an older open-balena-ui deployment or its HTML fallback.

- `OPEN_BALENA_BOOTSTRAP_USER_ID` The trusted existing user ID allowed to create and receive the first `global-admin`
  role at server startup. This must be the positive numeric `user.id` (for example `2`), not a username or email
  address. Leave it unset to retain legacy access when `global-admin` does not exist, in which every authenticated user
  is effectively a super administrator; remove it after successful bootstrap.

- `OPEN_BALENA_ORGANIZATION_ADMIN_ASSIGNABLE_ROLES` Optional comma-separated exact role names that `organization-admin`
  users may view and assign to users inside their organization scope. Administrator roles are always excluded. Leave
  unset to prevent organization administrators from changing user role assignments.

- `OPEN_BALENA_OS_CATALOG_API_URL` Optional source API for Services > BalenaOS synchronization. It defaults to the
  public `https://api.balena-cloud.com` catalog.

- `OPEN_BALENA_OS_REGISTRY_HOST` Optional registry hostname used for synchronized Host OS image locations. Set it to
  `registry2.balena-cloud.com` for direct public pulls, or to a local pull-through proxy hostname for restricted-egress
  deployments. The server otherwise discovers it from an existing local image, then falls back from `api.<domain>` to
  `registry.<domain>`. Configure this explicitly when neither convention is valid.

- `CONTRACT_ALLOWLIST` Mirror the API's semicolon-separated contract allowlist. `hw.device-type/<slug>` entries filter
  catalog discovery and metadata synchronization; architecture entries alone do not restrict device types.

- `OPEN_BALENA_S3_URL` S3-compatible endpoint (SeaweedFS S3 gateway, MinIO, or AWS S3). The UI server uses AWS SDK v3
  with forced path-style addressing; this is not the SeaweedFS filer endpoint. `OPEN_BALENA_S3_ACCESS_KEY` and
  `OPEN_BALENA_S3_SECRET_KEY` are server-only storage credentials, `OPEN_BALENA_S3_REGION` defaults to `us-east-1`, and
  `OPEN_BALENA_S3_REGISTRY_BUCKET` defaults to `registry-data`. Keep these backend-neutral variable names when changing
  storage providers.

- `OPEN_BALENA_OS_METADATA_BUCKET` Required private S3-compatible bucket for Host OS synchronization on API v46.1+.
  Provision it and grant the existing UI storage identity read/write access. Metadata is served by the UI, not by a
  public bucket policy.

- `OPEN_BALENA_OS_METADATA_URL` Optional stable UI base URL reachable from ob-api. Defaults to
  `REACT_APP_OPEN_BALENA_UI_URL`. The read-only `/balena-os/device-types/.../device-type.json` route needs no login.

- `OPEN_BALENA_OS_METADATA_SOURCE_URL` Optional public metadata source, used only during manual sync. Defaults to
  `https://resin-production-img-cloudformation.s3.amazonaws.com/images`.

For local development, `npm run dev` starts both Vite on port 3000 and the UI server on port 3001. Vite proxies
`/admin-db`, `/device-update-options`, and `/balena-os` requests to the local UI server; operational OData requests
continue to use `REACT_APP_OPEN_BALENA_API_URL`. The configured `OPEN_BALENA_POSTGREST_URL` must still be reachable from
the local machine and point directly to a PostgREST endpoint.

Services > BalenaOS shows local Host OS coverage and Balena Cloud's public Host OS catalog. A global administrator can
start an additive, idempotent synchronization into the required `balena_os` system organization. The server reads the
public catalog, rewrites Cloud registry locations to the configured Host OS registry hostname, and creates or updates
the application/release/service/image graph through open-balena-api. A server-only direct-database exception links each
Host OS application to its updater because public OData does not expose that internal relation. It also materializes
Host OS image labels from the public release composition so Supervisors distinguish OS payloads from ordinary services.
On open-balena-api v43.4.0 and newer it also imports the public `balena_os/balenahup` updater graph and links Host OS
applications to it so Helios can plan the actual OS transition. It does not delete local records. On API v46.1+, sync
also stores allowlisted device-type JSON in private S3-compatible storage and writes local release assets pointing to
the UI's read-only metadata endpoint. It creates and authorizes the release/key records through OData, then persists
only their WebResource references through internal PostgREST because PineJS rejects ordinary JSON asset writes. It
verifies all references, triggers the API's host-application metadata-cache hook, and checks API metadata before
reporting completion. This lets ob-api generate device config without public S3 metadata reads. The asset URL contains
no storage credentials; no ob-api image patch or `WEBRESOURCES_S3_*` configuration is needed. An internal metadata URL
only needs to be reachable by ob-api: it is not sent to devices in normal balenaOS provisioning or target-state
responses. Provisioning images and device image pulls use their separate helper/registry routes. For chart-managed
installations, the infrastructure chart owns the automated, idempotent MinIO-to-SeaweedFS migration and private
bucket/credential setup. Operators do not run manual migration commands in this UI repository; follow the installation's
infrastructure chart deployment guide. Existing MinIO deployments remain supported. Progress is kept in server memory,
so the UI polls every five seconds and the UI server must remain running until the job finishes. The configured registry
endpoint must either serve the public image directly or proxy missing paths to the source registry. Synchronization does
not copy registry blobs and does not automatically change any fleet or device target release. The `balena_os`
organization owns the imported catalog records only; Host OS releases are installation-wide and do not need to share an
organization with a target fleet. Synchronization is disabled until that system organization exists. Registry locations
are rewritten when records are synchronized; rerun the sync after changing `OPEN_BALENA_OS_REGISTRY_HOST` to update
existing imported image records.

See [OS_AND_SUPERVISOR_UPDATES.md](./OS_AND_SUPERVISOR_UPDATES.md) for the complete deployment, registry, organization,
security, and update-lifecycle configuration.

Host OS updates use the synchronized image location returned by open-balena-api's device-state endpoint. The helper's
`/download` route serves provisioning images, while its `/v6/supervisor_release` hostname rewrite applies only to
supervisor updates. Consequently, synchronized Host OS image locations do not require an open-balena-helper change. A
query-time Host OS rewrite would instead require proxying and transforming device-state responses, which the current
helper and deployment routing do not do.

Supervisor updates always assign a local release ID through `device.should_be_managed_by__release`;
`device.supervisor_version` is device-reported state and is never written by the UI. Compatible versions are obtained
from Balena Cloud's public release catalog by CPU architecture. When a selected release is not present locally, the UI
server synchronizes that release's application, service, image, and release graph through open-balena-api before
assigning it. Supervisor applications are owned by a `balena_os` system organization so their required
`balena_os/<architecture>-supervisor` slugs are preserved. Because open-balena-api does not expose organization
creation, this organization must be provisioned through the installation's administrative bootstrap before a Supervisor
release is assigned, and the administrative API identity must be a member. The synchronized image location uses the same
configured registry hostname as Host OS synchronization, so deployments whose helper implements `/v6/supervisor_release`
can retain their existing Supervisor image proxy. A public-catalog lookup or synchronization failure is reported to the
user; it is not treated as an empty catalog.

For direct public pulls, set `OPEN_BALENA_OS_REGISTRY_HOST=registry2.balena-cloud.com`. This intentionally preserves the
source image location instead of changing its hostname. Devices must be able to reach `registry2.balena-cloud.com` for
manifests, its token realm at `api.balena-cloud.com`, and `registry-data.balena-cloud.com` for redirected image blobs;
the public Host OS repositories issue anonymous pull tokens. No local registry or proxy participates in those Host OS
pulls, although openBalena still needs its normal private registry for user application images and locally produced
releases.

For restricted-egress or caching deployments, put an authentication-aware routing proxy in front of the private
registry. Stock openBalena does not configure this Cloud fallback. Mutating requests must go only to the private
registry; reads should prefer private content and fall back to `registry2.balena-cloud.com`. The proxy must keep device
credentials and the private registry authentication challenge away from Balena Cloud, perform the public registry token
exchange itself, and avoid exposing the Cloud hostname to devices. A plain Distribution `proxy.remoteurl` configuration
is not generally sufficient because the same endpoint must continue to accept private pushes. Set
`OPEN_BALENA_OS_REGISTRY_HOST` to the externally reachable proxy hostname, restart the UI server, rerun synchronization,
and verify that an image absent from private storage can be pulled before assigning the release to a device.

The synchronization scope can be:

- **Latest + in use:** the latest usable release published for each device type, plus Host OS versions currently
  reported by devices of that type.
- **Newer than version + in use:** releases strictly newer than the entered semantic version, plus Host OS versions
  currently reported by devices of each device type.
- **Only versions in use:** only Host OS versions currently reported by devices, grouped by device type.
- **Single semantic version:** the requested version wherever that device type publishes it.
- **All catalog versions:** every usable release advertised by the version-appropriate public Host OS catalog.

When an entered or device-reported version omits build metadata such as `+rev1`, matching revisions are included. The
newer-than mode treats higher `+revN` builds of the threshold version as newer; a threshold without a revision includes
all revised builds of that version but not the unrevised version itself. The server fetches image and release-image
metadata only for selected releases, so selective modes reduce both database growth and catalog-transfer volume. When a
selected release has a `+revN` revision, its earlier non-invalidated revisions of the same semantic version are also
imported because open-balena-api assigns revisions sequentially. Invalidated releases are excluded from catalog counts
and every semantic-version decision. An invalidated release is imported only when a device of the matching type already
reports that exact version; it remains marked invalidated locally so it cannot be offered as an update target to other
devices.

On API v46.1+, each Host OS scope additionally maintains the latest usable release per allowed device type and its
prerequisite revisions for complete config-metadata coverage. The coverage pass attaches metadata to the newest eligible
local release, including an already-local release newer than those imported. Supervisor-only sync and older APIs are
unchanged. See [OS_AND_SUPERVISOR_UPDATES.md](./OS_AND_SUPERVISOR_UPDATES.md) for storage setup and cache refresh.

- `REACT_APP_OPEN_BALENA_REMOTE_URL` Optional URL of a legacy `open-balena-remote` instance, for example
  `http://remote.openbalena.local:10000`. When this is non-empty, device Connect windows use the legacy iframe flow.
  Leave it empty or unset to use the built-in terminal and streaming SFTP implementation.
  An explicitly empty runtime value overrides a legacy URL embedded at build time; an absent runtime setting retains
  the build-time default. Legacy mode retains its fullscreen control even when the built-in gateway is also configured.

- `REACT_APP_OPEN_BALENA_API_URL` The URL (accessible to API) of the `open-balena-api` instance, i.e.
  `https://api.openbalena.local`

- `REACT_APP_OPEN_BALENA_API_VERSION` The version of `open-balena-api` that the above instance is running, i.e.
  `v0.139.0`

- `REACT_APP_OPEN_BALENA_ODATA_VERSION` Optional OData endpoint override (`v6` or `v7`). By default, the provider uses
  `v7` on open-balena-api v26.1.0 and newer and falls back to `v6` on older servers.

- `REACT_APP_BANNER_IMAGE` The URL of a custom banner image to use on the main dashboard.

Built-in remote access uses these server-only variables:

- `OPEN_BALENA_TUNNEL_URL` Required HTTP(S) endpoint for the openBalena CONNECT tunnel. Use HTTPS for external
  endpoints, or `http://ob-vpn.openbalena.svc.cluster.local:3128` on a trusted private network. Plain HTTP exposes proxy
  authentication to that network; SSH payloads remain encrypted. The VPN port `443` can require PROXY protocol and is
  not interchangeable with the direct CONNECT port. The UI server connects here; browsers do not.
- `OPEN_BALENA_SSH_TARGET_PORT` Device SSH port requested through the tunnel. Defaults to `22222`.
- `OPEN_BALENA_SSH_KEY_IDLE_TTL_MS` How long the per-user ephemeral SSH key remains registered after that user's last
  terminal or transfer closes. Defaults to `600000` (10 minutes).
- `OPEN_BALENA_SSH_HOST_KEYS` Comma-separated SHA-256 SSH host-key pins. Each entry is either a wildcard fingerprint
  (`SHA256:...`) or `device-uuid=SHA256:...` / `device-uuid.balena=SHA256:...`.
- `OPEN_BALENA_SSH_ALLOW_UNVERIFIED_HOST_KEYS` Compatibility escape hatch for devices without managed host-key pins.
  Defaults to `false`. An explicitly configured pin still rejects a mismatching key.
- `OPEN_BALENA_REMOTE_ALLOWED_ORIGINS` Optional comma-separated additional browser origins allowed to create terminal
  WebSockets. Same-origin requests are allowed automatically.
- `OPEN_BALENA_REMOTE_CONNECT_TIMEOUT_MS` Tunnel and SSH connection timeout. Defaults to `15000`.
- `OPEN_BALENA_REMOTE_TICKET_TTL_MS` Lifetime of single-use WebSocket tickets. Defaults to `30000`.
- `OPEN_BALENA_REMOTE_MAX_PENDING_TICKETS_PER_USER` Maximum unconsumed terminal tickets per user. Defaults to `8`.
- `OPEN_BALENA_REMOTE_MAX_PENDING_TICKETS` Maximum unconsumed terminal tickets per server process. Defaults to `1024`.
  Exceeding either pending-ticket limit returns HTTP `429` with `Retry-After`. Expired tickets are removed automatically,
  without requiring another request, and consumption releases their slots.
- `OPEN_BALENA_REMOTE_MAX_OPERATIONS_PER_USER` Maximum concurrent terminal/SFTP operations per user. Defaults to `8`.
- `OPEN_BALENA_REMOTE_MAX_WEBSOCKETS_PER_IP` Maximum simultaneous terminal WebSockets per source IP. Defaults to `8`.
- `OPEN_BALENA_REMOTE_MAX_CHANNELS_PER_SOCKET` Maximum logical terminals per browser WebSocket. Defaults to `4`.
- `OPEN_BALENA_REMOTE_MAX_MESSAGE_BYTES` Maximum WebSocket message size. Defaults to `1048576`.
- `OPEN_BALENA_REMOTE_MAX_UPLOAD_BYTES` Maximum upload size. Defaults to `1073741824` (1 GiB).
- `OPEN_BALENA_REMOTE_MAX_PATH_BYTES` Maximum UTF-8 byte length of a device file path. Defaults to `4096`.

The built-in gateway also requires `OPEN_BALENA_POSTGREST_URL`, `OPEN_BALENA_JWT_SECRET`, and
`REACT_APP_OPEN_BALENA_API_URL`, which are shared with the existing authenticated UI server routes. See
[REMOTE_ACCESS_ARCHITECTURE.md](REMOTE_ACCESS_ARCHITECTURE.md) for protocol details, trust boundaries, host-key
management, deployment, and troubleshooting.

These variables can be supplied through the standard Vite `.env` files (for example `.env`, `.env.local`, or
`.env.<mode>` when invoking `vite --mode <mode>`). The active mode is already set for the provided `npm run dev` and
`npm run dev:local` scripts.

## Device logs

The device dashboard polls logs automatically about every two seconds while at least one source is selected. Use the App
and Supervisor checklist menus to combine sources; Host OS is the first Supervisor-menu entry. The log buttons in
service tables toggle the same selections. Clearing all selections empties the viewer and stops polling.

Log contents use the terminal's monospace font. ANSI colors are preserved safely, and structured JSON `level`/`severity`
fields color informational, warning, and error messages. Download exports the currently displayed, filtered entries as
plain text. Clear removes existing entries and prevents old API history from reappearing on subsequent polls or source
changes; the cutoff resets when the viewer is reloaded or a different device is opened.

Search is case-insensitive. **Add filter** supports message and timestamp conditions, with **Add alternative** combining
conditions using OR. Separate filters and the search query combine using AND. Timestamp inputs use local time and are
stored as timezone-qualified ISO timestamps. The browser retains at most 5,000 captured entries, not unlimited device
history. See [REMOTE_ACCESS_ARCHITECTURE.md](REMOTE_ACCESS_ARCHITECTURE.md#device-log-viewer) for details.

## Exposing Device Connection Endpoints

Each device has a "Connect" button. Built-in mode offers Host OS and running application-container SSH targets without
requiring image labels. Targets are ordered Host OS, App services, then supported Supervisor services; the same service
colors and ordering are used in the service tables and logs picker. Use `+` to add independent terminal tabs and the
expand button to fill the browser viewport without reconnecting sessions or hiding the device name. Close a shell using
its tab's `X`. Idle shells are kept alive on both the browser WebSocket and upstream SSH tunnel. The Upload/Download
panel has an independent Host OS/container selector with the terminal's ordering and colors. Enter an absolute path
inside the selected filesystem to upload or download; progress and cancellation are shown. Container transfers use host
SFTP against the running container's filesystem and require no SFTP server inside the image. Supported browsers stream
downloads into a chosen local file; other browsers use a clearly indicated browser-memory fallback. See
[REMOTE_ACCESS_ARCHITECTURE.md](REMOTE_ACCESS_ARCHITECTURE.md) for session ownership, authentication, and transfer
limitations.

Successful downloads display the actual received byte count alongside the source path.

**Download save-prompt timing:** Browsers supporting streamed saves show the destination picker before checking the
remote file. The picker requires transient user activation from the Download click; waiting for remote authorization and
SSH/SFTP checks first can exhaust that activation and prevent the picker from opening. Consequently, errors such as "No
such file", permission errors, or connection failures appear after the save prompt, for both Host OS and container
downloads. Remote validation failures occur before downloaded bytes are written. We intentionally do not pre-check paths
while typing: that would add debouncing delays and remote requests, and a successful check cannot guarantee the file
still exists or remains readable when the download begins. Browsers using the browser-memory fallback instead fetch the
file successfully before triggering the local download.

The HTTP, HTTPS, and VNC label discovery described below is available only through the legacy `open-balena-remote` flow.
To make use of that legacy auto-discovery, add tags to each container within your application's `docker-compose` file
where you would like to expose services. Examples of the three types of services available to expose are provided below
(http, https and vnc); note that ssh services are enabled by default and do not need labels. When a device is running an
application that exposes container services using the label constructs below, you will see the service appear in the
list of available connections for that container when clicking the "Connect" button for that device in the admin ui.

HTTP Services:

```sh
    labels:
      openbalena.remote.http: '1'
      openbalena.remote.http.port: '5003'
      openbalena.remote.http.path: '/'
```

HTTPS Services:

```sh
    labels:
      openbalena.remote.https: '1'
      openbalena.remote.https.port: '1880'
      openbalena.remote.https.path: '/nr-admin'
```

VNC Services:

```sh
    labels:
      openbalena.remote.vnc: '1'
      openbalena.remote.vnc.port: '5900'
```

**Note**: The port specified above is a host container port, so the service needs to be mapped to a host port matching
the port specified in the label in your `docker-compose` file.

## Dashboard URL Routes

`open-balena-ui` includes routes that conform to the standard balena convention that you will see when running
`balena devices` using `balena-cli`. Specifically, if you point your browser to your `open-balena-ui` server with a path
of `/devices/<UUID>/summary`, it will redirect you to the dashboard for that device. If you point the
`dashboard.yourdomain.com` host to your `open-balena-ui` instance, the URL should conform to the standard balena
convention.

## Compatibility

`open-balena-ui` supports `open-balena-api` **v0.139.0 and newer**.

Maintaining compatibility across this range requires more than checking the API generation exposed at `/v6` or `/v7`.
The `open-balena-api` data model has evolved substantially over time, and fields, relationships, and their semantics are
sometimes added, renamed, migrated, or removed without changing the API generation.

For that reason, `open-balena-ui` maintains a version compatibility layer in `src/versions/index.ts`.

### `REACT_APP_OPEN_BALENA_API_VERSION`

`REACT_APP_OPEN_BALENA_API_VERSION` **must contain the tagged semver release of the `open-balena-api` server being
used**, for example:

```text
REACT_APP_OPEN_BALENA_API_VERSION=v25.2.8
```

or:

```text
REACT_APP_OPEN_BALENA_API_VERSION=v45.0.0
```

The leading `v` is optional for the compatibility resolver.

This value is **not** the API generation from the URL.

For example:

```text
v45.0.0       # open-balena-api package/release version - correct
45.0.0        # also accepted - correct

v7            # API generation - incorrect
v6            # API generation - incorrect
```

The `/v6` and `/v7` API generations describe revisions of the external API contract. They are not sufficiently granular
for UI compatibility decisions. `open-balena-api` frequently changes its SBVR model, generated resources, fields, or
field semantics while continuing to expose the same `/v7` API generation.

The value supplied to `REACT_APP_OPEN_BALENA_API_VERSION` should therefore correspond to the actual `open-balena-api`
release/tag used by the deployment, such as the API container image version or the version reported by the
`open-balena-api` package.

This distinction is important. For example, both `open-balena-api` v25 and v45 expose API v7, but they require different
compatibility behavior in `open-balena-ui`.

### How version compatibility works

`src/versions/index.ts` provides semantic aliases for API resources and fields whose underlying SBVR names have changed
over the lifetime of `open-balena-api`.

Application code should refer to the semantic alias rather than independently deciding which API field name to use.

For example:

```ts
const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);
```

and:

```ts
const deviceOnlineStatus = versions.field('deviceOnlineStatus', environment.REACT_APP_OPEN_BALENA_API_VERSION);
```

The mappings in `src/versions/index.ts` are keyed by the specific `open-balena-api` semver release where a compatibility
boundary occurs.

They are **change points**, not a list of every supported API version.

For example, given mappings at:

```text
0.185.0
25.2.8
45.0.0
```

a deployment running `open-balena-api` v25.0.6 selects the `0.185.0` compatibility map, because that is the newest known
compatibility boundary less than or equal to v25.0.6.

A deployment running v25.2.8 selects the `25.2.8` map.

A deployment running v44.3.0 also selects the `25.2.8` map.

A deployment running v45.0.0 or a later release selects the `45.0.0` map.

Internally, the resolver finds the greatest mapped semver that is less than or equal to
`REACT_APP_OPEN_BALENA_API_VERSION`. Each new mapping inherits the previous mapping and overrides only the resources or
fields that changed.

For example:

```ts
versions['45.0.0'] = {
  resources: {
    ...versions['25.2.8'].resources,
  },
  fields: {
    ...versions['25.2.8'].fields,
    deviceOnlineStatus: 'is connected to vpn',
  },
  translations: {
    ...versions['25.2.8'].translations,
  },
};
```

There is therefore no need to add entries for v25.2.9, v26, v30, v44, etc. unless one of those versions introduces
another API difference that `open-balena-ui` needs to account for.

If a requested semantic key has no explicit mapping, `versions.resource()` or `versions.field()` returns the supplied
key unchanged.

If `REACT_APP_OPEN_BALENA_API_VERSION` is omitted, or no configured compatibility boundary is less than or equal to the
supplied version, the current resolver falls back to the newest known compatibility map. Because of this behavior,
deployments should always configure the actual supported `open-balena-api` version. Versions older than v0.139.0 are
outside the supported compatibility range.

### Currently tracked compatibility boundaries

The compatibility map currently tracks the following `open-balena-api` change points. Each entry inherits all mappings
from the preceding entry.

| `open-balena-api` version | Compatibility change introduced at this boundary                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.139.0**              | Oldest supported API version. `isPinnedOnRelease` resolves to the legacy device relation `should be running-release`. `deviceOnlineStatus` resolves to `api heartbeat state`. |
| **v0.149.0**              | Adds mappings for release finalization, semantic-version components, revision, final status, and semver.                                                                      |
| **v0.157.3**              | Adds `applicationIsOfClass` → `is of-class`.                                                                                                                                  |
| **v0.158.0**              | Adds `releaseKnownIssueList` → `known issue list`.                                                                                                                            |
| **v0.170.0**              | Adds `releaseNote` → `note`.                                                                                                                                                  |
| **v0.171.0**              | Adds `releaseInvalidationReason` → `invalidation reason`.                                                                                                                     |
| **v0.185.0**              | Adds `deviceTypeAlias` → `device type alias`.                                                                                                                                 |
| **v25.2.8**               | Changes `isPinnedOnRelease` from the legacy `should be running-release` relation to `is pinned on-release`.                                                                   |
| **v26.1.0**               | Adds the native OData v7 model and changes the provider's default endpoint from `/v6` to `/v7`.                                                                               |
| **v45.0.0**               | Changes the UI's semantic `deviceOnlineStatus` field from `api heartbeat state` to `is connected to vpn`.                                                                     |

The complete baseline for the two compatibility aliases that span the largest API ranges is therefore:

```ts
'0.139.0': {
  resources: {
    isPinnedOnRelease: 'should be running-release',
  },
  fields: {
    deviceOnlineStatus: 'api heartbeat state',
  },
  translations: {},
},
```

with the later overrides:

```ts
versions['25.2.8'] = {
  resources: {
    ...versions['0.185.0'].resources,
    isPinnedOnRelease: 'is pinned on-release',
  },
  fields: {
    ...versions['0.185.0'].fields,
  },
  translations: {
    ...versions['0.185.0'].translations,
  },
};

versions['45.0.0'] = {
  resources: {
    ...versions['25.2.8'].resources,
  },
  fields: {
    ...versions['25.2.8'].fields,
    deviceOnlineStatus: 'is connected to vpn',
  },
  translations: {
    ...versions['25.2.8'].translations,
  },
};
```

### Device release pinning compatibility

Device release pinning is an example of why the compatibility layer is based on `open-balena-api` release versions
rather than API generations.

Older versions of the API exposed the device target/pinning relationship through:

```text
should be running-release
```

The newer explicit pinning relationship is:

```text
is pinned on-release
```

The migration inside `open-balena-api` happened in several stages:

| Version     | Pinning migration                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **v23.3.0** | Added `is pinned on-release` and synchronized it with the legacy relationship.                                                           |
| **v25.2.0** | Changed the API's read/source-of-truth behavior to use the new pin relationship while retaining compatibility with the old storage path. |
| **v25.2.8** | Stopped setting the legacy `should_be_running__release` value and removed the old fact from the SBVR model.                              |
| **v26.0.1** | Added cleanup to drop the old database column if it still existed.                                                                       |

For `open-balena-ui`, **v25.2.8 is the compatibility boundary** because it is the first release where the legacy
relation can no longer be relied upon.

Consequently:

```text
open-balena-api v0.139.0 through v25.2.7
    isPinnedOnRelease
    → "should be running-release"

open-balena-api v25.2.8 and newer
    isPinnedOnRelease
    → "is pinned on-release"
```

Application code should therefore use:

```ts
const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);
```

and then use `isPinnedOnRelease` directly as the `source`, record key, query field, or mutation field as appropriate.

Compatibility code should **not** transform device or fleet JSON records back and forth between the old and new field
names. The purpose of `versions.resource()` is to make that transformation unnecessary.

For example, prefer:

```tsx
<ReferenceInput
  source={isPinnedOnRelease}
  reference='release'
  target='id'
>
```

rather than creating a `transformDevice()` or `transformFleet()` function that deletes one SBVR property and
manufactures another.

This keeps the object returned by the API in its native schema and confines version-specific knowledge to
`src/versions/index.ts`.

Also note that:

```text
application should track latest release
```

is a separate application-level fact. It should not be confused with the device-level migration from
`should be running-release` to `is pinned on-release`.

### Device connectivity and online-status compatibility

`open-balena-api` v45.0.0 introduced another important compatibility boundary.

Before v45, API/UI logic traditionally used heartbeat/online state when deciding whether a device should be treated as
online. Beginning with v45.0.0, `open-balena-api` changed the canonical connectivity signal used by
`device.overall_status` from `is online` to:

```text
is connected to vpn
```

This was **not a schema rename**.

Fields such as:

```text
api heartbeat state
is online
is connected to vpn
last connectivity event
last vpn event
```

exist independently. The v45 change was a change in the meaning of the canonical connectivity state, not the removal of
`api heartbeat state`.

For `open-balena-ui`, a semantic compatibility alias is therefore used:

```ts
deviceOnlineStatus;
```

which resolves as:

```text
open-balena-api v0.139.0 through v44.x
    deviceOnlineStatus
    → "api heartbeat state"

open-balena-api v45.0.0 and newer
    deviceOnlineStatus
    → "is connected to vpn"
```

This is particularly important for structured filters.

Instead of hard-coding either:

```ts
'api heartbeat state@eq';
```

or:

```ts
'is connected to vpn@eq';
```

the filter should resolve the semantic field first:

```ts
const deviceOnlineStatus = versions.field('deviceOnlineStatus', environment.REACT_APP_OPEN_BALENA_API_VERSION);

const deviceOnlineStatusFilter = `${deviceOnlineStatus}@eq`;
```

and use it in the list of structured filter keys:

```ts
const STRUCTURED_FILTER_KEYS = [
  deviceOnlineStatusFilter,
  'is of-device type@eq',
  'belongs to-application@eq',
  'is running-release@in',
  'os version@ilike',
] as const;
```

This matters not only when applying a filter, but also when replacing or removing structured filters. A UI connected to
a pre-v45 API must remove:

```text
api heartbeat state@eq
```

while a UI connected to v45 or newer must remove:

```text
is connected to vpn@eq
```

Hard-coding both field names into `STRUCTURED_FILTER_KEYS` is not equivalent: the configured API version should
determine which field represents the semantic "online status" for that deployment.

#### Connectivity filter values

The v45 compatibility change also changes the **type and meaning of the filter value**, so resolving the field name
alone is not sufficient.

Before v45, `api heartbeat state` is a state value. For example:

```text
api heartbeat state = "online"
api heartbeat state = "offline"
```

The raw field may also contain other states such as `timeout` or `unknown`.

From v45 onward, the UI's canonical connectivity filter uses the boolean VPN relation:

```text
is connected to vpn = true
is connected to vpn = false
```

Therefore a UI-level filter state such as:

```ts
'online' | 'offline' | 'all';
```

must be serialized differently according to the resolved compatibility field.

Conceptually:

```ts
const usesVpnConnectivity = deviceOnlineStatus === 'is connected to vpn';

listFilters[deviceOnlineStatusFilter] = usesVpnConnectivity ? filters.onlineStatus === 'online' : filters.onlineStatus;
```

Similarly, when converting a react-admin filter back into the structured UI state, pre-v45 code interprets string
heartbeat states while v45+ code interprets boolean VPN connectivity.

The version map is responsible for selecting the **field name**. Code using that field remains responsible for handling
differences in the field's **value semantics**.

### Resource and field aliases should be used throughout the UI

When an API concept already has an entry in `src/versions/index.ts`, components should use that entry consistently.

Do not duplicate version tests such as:

```ts
if (apiVersion >= ...) {
  // use one SBVR field
} else {
  // use another SBVR field
}
```

throughout components.

Likewise, do not normalize API objects by deleting old properties and adding new properties merely to make newer UI code
work against older API versions.

Instead, resolve the API-specific name once:

```ts
const isPinnedOnRelease = versions.resource('isPinnedOnRelease', environment.REACT_APP_OPEN_BALENA_API_VERSION);

const deviceOnlineStatus = versions.field('deviceOnlineStatus', environment.REACT_APP_OPEN_BALENA_API_VERSION);
```

and use those resolved names wherever the corresponding concept is accessed.

This provides one source of truth for API-version differences and prevents different parts of the UI from making
different assumptions about the same API release.

### Adding compatibility for future API changes

When a newer `open-balena-api` release changes a resource, field, or the semantics the UI depends on:

1. Determine the **exact tagged `open-balena-api` release** where the relevant change becomes applicable. Do not use the
   `/v6` or `/v7` API generation as the compatibility boundary.
2. Inspect the `open-balena-api` commit history, changelog, SBVR model, and migrations as necessary. API migrations are
   often staged across several releases, so distinguish between when a new field is introduced, when it becomes
   authoritative, and when the old field is actually removed.
3. Add a semantic alias to the oldest supported mapping if the UI needs to refer to the concept across the entire
   supported version range.
4. Add a new version entry at the appropriate change point, inheriting the preceding `resources`, `fields`, and
   `translations` maps and overriding only the values that changed.
5. Access the concept through `versions.resource()` or `versions.field()` throughout the UI rather than introducing
   component-specific version checks or rewriting API records.
6. If the change also alters the type or meaning of the value—as with heartbeat strings versus VPN booleans—handle that
   conversion at the point where the value is interpreted or serialized. A field-name mapping by itself does not perform
   value conversion.
7. Preserve compatibility with the existing v0.139.0 minimum unless the project's documented minimum supported
   `open-balena-api` version is intentionally changed.

A new mapping should be added only when the UI needs different behavior starting with that particular `open-balena-api`
release.

The compatibility layer is intended to allow the current `open-balena-ui` codebase to operate against both older
supported OpenBalena installations and current `open-balena-api` releases without scattering version-specific SBVR
knowledge throughout the application. Operational data uses the backwards-compatible OData v6 endpoint on older servers
and v7 where supported, and accepts both legacy and current OData response envelopes. See
[API_VERSIONS.md](API_VERSIONS.md) for the provider's compatibility and degradation behavior and
[ACCESS_CONTROLS.md](ACCESS_CONTROLS.md) for administrator role setup and PostgREST security requirements.

## Installation

Ensure you are running Node.js 24 or newer locally to match the production image and CI configuration.

Set the required environment variables accordingly, and run `npm run start` from the main project folder. If running
locally, you can access `open-balena-ui` via your web browser at `http://localhost:PORT`, and provided the configuration
environment variables are appropriately pointed to live `open-balena-api` and `open-balena-postgrest` instances, you
should be up and running.

## Development

Unauthenticated requests to the production server's SPA HTML fallback and public device-type metadata are limited to 600
requests per five minutes per client IP, per server process. Successful authenticated responses do not consume
rate-limit quotas; authenticated failures are counted separately by verified user identity. Invalid/expired bearer
tokens cannot claim that exemption, and excess requests return HTTP 429 before filesystem access. The existing protected
API limiter retains its stricter 100-failure quota and slowdown; BalenaOS status uses a 600-failure quota. Static assets
remain outside these quotas. A normal HTML navigation carries no JWT and is therefore treated as unauthenticated even if
the UI has a token in local storage; authenticated API requests explicitly send their bearer token. No authentication
cookie or token-in-URL mechanism is introduced.

Explicit HTML entrypoints, including percent-encoded forms of `index.html`, use the same protected runtime-injected
response as SPA navigation; they are not served as raw static assets. Remote streaming routes are mounted before
general JSON parsers so JSON file uploads are neither buffered nor consumed by unrelated API middleware.

Credential verification runs inside each limiter's asynchronous key generator, so the limiter is the first middleware
on these routes rather than a separate authentication handler preceding it. Only verified JWT claims select an
authenticated bucket; header presence alone never grants authentication or an exemption. Missing credentials remain
anonymous on public routes, while supplied invalid credentials are rejected after their request is counted.

For local development, the Vite 7 dev server exposes two modes:

- `npm run dev` launches with the `devprod` mode configuration (mirroring hosted settings).
- `npm run dev:local` loads the `local` mode configuration for working against local services.

When you need a production-like client build, run `npm run build:client` (or `npm run build` to bundle both client and
server) followed by `npm run serve` to boot the compiled Express server.

After dependency updates, include the regenerated `package-lock.json` and validate the locked install before opening a
PR:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm audit
```

Keep `react-admin` and `ra-core` on the same version, and keep `react-router` and `react-router-dom` aligned.

The opt-in Host OS synchronization regression uses real open-balena-api v49.6.5, PostgreSQL, Redis, and PostgREST
containers with synthetic data. It requires Docker with Linux containers, verifies all five metadata references,
permissions, idempotent recovery, cache invalidation, and actual device configuration generation, and cleans up its
isolated resources. The fixture uses the configured Docker context (or `DOCKER_HOST`) on Windows and Linux; select a
daemon with Linux containers before running it. Fixture transport failures return a fixed plain-text message, while
diagnostic details stay in test-process logs. CI runs it before building the image. Run it locally with:

```sh
BALENA_OS_INTEGRATION=1 npx tsx --test test/balenaOsSync.integration.test.ts
```

In PowerShell:

```powershell
$env:BALENA_OS_INTEGRATION = '1'
npx tsx --test test\balenaOsSync.integration.test.ts
Remove-Item Env:\BALENA_OS_INTEGRATION
```

## Credits

- The [ra-data-postgrest](https://github.com/raphiniert-com/ra-data-postgrest) project was instrumental in establishing
  the link to the open-balena database

## Legacy Items

- **Expanded Vite config**: The configuration keeps legacy behavior from the original webpack/CRA setup—explicit aliases
  and polyfills for the Node-style modules above, plus tailored build/preview settings so the Express server can serve
  the SPA exactly as before.
