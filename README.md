# User Interface for Open Balena Admin

User interface for [open-balena-admin](https://github.com/ob-community/open-balena-admin), an admin interface for
open-balena.

## Dependencies

This project uses `open-balena-api` for operational data and depends on
[open-balena-postgrest](https://github.com/ob-community/open-balena-postgrest) only for administrator identity and
authorization resources that the API does not expose with the required global semantics. It also depends on
[open-balena-remote](https://github.com/ob-community/open-balena-remote), so the easiest way to get this up and
running would be to install it via the [open-balena-admin](https://github.com/ob-community/open-balena-admin)
project. See [DIRECT_DB_ACCESS.md](DIRECT_DB_ACCESS.md) for the security and deployment implications of the hybrid
provider.

## Configuration

There are a number of environment variables used to configure the ui:

- `PORT` - The port that the ui will listen on

- `OPEN_BALENA_POSTGREST_URL` The internal URL (accessible to the UI server, not browsers) of the
  `open-balena-postgrest` instance, i.e.
  `http://postgrest.openbalena.local:8000`

- `OPEN_BALENA_BOOTSTRAP_USER_ID` The trusted existing user ID allowed to create and receive the first `global-admin`
  role. It is used only before administrator access-control enforcement is activated.

- `REACT_APP_OPEN_BALENA_REMOTE_URL` The URL (accessible to API) of the `open-balena-remote` instance, i.e.
  `http://remote.openbalena.local:10000`

- `REACT_APP_OPEN_BALENA_API_URL` The URL (accessible to API) of the `open-balena-api` instance, i.e.
  `https://api.openbalena.local`

- `REACT_APP_OPEN_BALENA_API_VERSION` The version of `open-balena-api` that the above instance is running, i.e.
  `v0.139.0`

- `REACT_APP_OPEN_BALENA_ODATA_VERSION` Optional OData endpoint override (`v6` or `v7`). By default, the provider uses
  `v7` on open-balena-api v25.2.8 and newer and falls back to `v6` on older servers.

- `REACT_APP_BANNER_IMAGE` The URL of a custom banner image to use on the main dashboard.

These variables can be supplied through the standard Vite `.env` files (for example `.env`, `.env.local`, or
`.env.<mode>` when invoking `vite --mode <mode>`). The active mode is already set for the provided `npm run dev` and
`npm run dev:local` scripts.

## Exposing Device Connection Endpoints

Each device has a "Connect" button which uses balena image labels to discover available services on that device. To make
use of this auto-discovery, you will need to add tags to each container within your balena application's
`docker-compose` file where you would like to expose services. Examples of the three types of services available to
expose are provided below (http, https and vnc); note that ssh services are enabled by default and do not need labels.
When a device is running an application that exposes container services using the label constructs below, you will see
the service appear in the list of available connections for that container when clicking the "Connect" button for that
device in the admin ui.

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

Maintaining compatibility across this range requires more than checking the API generation exposed at `/v6` or `/v7`. The `open-balena-api` data model has evolved substantially over time, and fields, relationships, and their semantics are sometimes added, renamed, migrated, or removed without changing the API generation.

For that reason, `open-balena-ui` maintains a version compatibility layer in `src/versions/index.ts`.

### `REACT_APP_OPEN_BALENA_API_VERSION`

`REACT_APP_OPEN_BALENA_API_VERSION` **must contain the tagged semver release of the `open-balena-api` server being used**, for example:

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

The `/v6` and `/v7` API generations describe revisions of the external API contract. They are not sufficiently granular for UI compatibility decisions. `open-balena-api` frequently changes its SBVR model, generated resources, fields, or field semantics while continuing to expose the same `/v7` API generation.

The value supplied to `REACT_APP_OPEN_BALENA_API_VERSION` should therefore correspond to the actual `open-balena-api` release/tag used by the deployment, such as the API container image version or the version reported by the `open-balena-api` package.

This distinction is important. For example, both `open-balena-api` v25 and v45 expose API v7, but they require different compatibility behavior in `open-balena-ui`.

### How version compatibility works

`src/versions/index.ts` provides semantic aliases for API resources and fields whose underlying SBVR names have changed over the lifetime of `open-balena-api`.

Application code should refer to the semantic alias rather than independently deciding which API field name to use.

For example:

```ts
const isPinnedOnRelease = versions.resource(
  'isPinnedOnRelease',
  environment.REACT_APP_OPEN_BALENA_API_VERSION,
);
```

and:

```ts
const deviceOnlineStatus = versions.field(
  'deviceOnlineStatus',
  environment.REACT_APP_OPEN_BALENA_API_VERSION,
);
```

The mappings in `src/versions/index.ts` are keyed by the specific `open-balena-api` semver release where a compatibility boundary occurs.

They are **change points**, not a list of every supported API version.

For example, given mappings at:

```text
0.185.0
25.2.8
45.0.0
```

a deployment running `open-balena-api` v25.0.6 selects the `0.185.0` compatibility map, because that is the newest known compatibility boundary less than or equal to v25.0.6.

A deployment running v25.2.8 selects the `25.2.8` map.

A deployment running v44.3.0 also selects the `25.2.8` map.

A deployment running v45.0.0 or a later release selects the `45.0.0` map.

Internally, the resolver finds the greatest mapped semver that is less than or equal to `REACT_APP_OPEN_BALENA_API_VERSION`. Each new mapping inherits the previous mapping and overrides only the resources or fields that changed.

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

There is therefore no need to add entries for v25.2.9, v26, v30, v44, etc. unless one of those versions introduces another API difference that `open-balena-ui` needs to account for.

If a requested semantic key has no explicit mapping, `versions.resource()` or `versions.field()` returns the supplied key unchanged.

If `REACT_APP_OPEN_BALENA_API_VERSION` is omitted, or no configured compatibility boundary is less than or equal to the supplied version, the current resolver falls back to the newest known compatibility map. Because of this behavior, deployments should always configure the actual supported `open-balena-api` version. Versions older than v0.139.0 are outside the supported compatibility range.

### Currently tracked compatibility boundaries

The compatibility map currently tracks the following `open-balena-api` change points. Each entry inherits all mappings from the preceding entry.

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

Device release pinning is an example of why the compatibility layer is based on `open-balena-api` release versions rather than API generations.

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

For `open-balena-ui`, **v25.2.8 is the compatibility boundary** because it is the first release where the legacy relation can no longer be relied upon.

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
const isPinnedOnRelease = versions.resource(
  'isPinnedOnRelease',
  environment.REACT_APP_OPEN_BALENA_API_VERSION,
);
```

and then use `isPinnedOnRelease` directly as the `source`, record key, query field, or mutation field as appropriate.

Compatibility code should **not** transform device or fleet JSON records back and forth between the old and new field names. The purpose of `versions.resource()` is to make that transformation unnecessary.

For example, prefer:

```tsx
<ReferenceInput
  source={isPinnedOnRelease}
  reference='release'
  target='id'
>
```

rather than creating a `transformDevice()` or `transformFleet()` function that deletes one SBVR property and manufactures another.

This keeps the object returned by the API in its native schema and confines version-specific knowledge to `src/versions/index.ts`.

Also note that:

```text
application should track latest release
```

is a separate application-level fact. It should not be confused with the device-level migration from `should be running-release` to `is pinned on-release`.

### Device connectivity and online-status compatibility

`open-balena-api` v45.0.0 introduced another important compatibility boundary.

Before v45, API/UI logic traditionally used heartbeat/online state when deciding whether a device should be treated as online. Beginning with v45.0.0, `open-balena-api` changed the canonical connectivity signal used by `device.overall_status` from `is online` to:

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

exist independently. The v45 change was a change in the meaning of the canonical connectivity state, not the removal of `api heartbeat state`.

For `open-balena-ui`, a semantic compatibility alias is therefore used:

```ts
deviceOnlineStatus
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
'api heartbeat state@eq'
```

or:

```ts
'is connected to vpn@eq'
```

the filter should resolve the semantic field first:

```ts
const deviceOnlineStatus = versions.field(
  'deviceOnlineStatus',
  environment.REACT_APP_OPEN_BALENA_API_VERSION,
);

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

This matters not only when applying a filter, but also when replacing or removing structured filters. A UI connected to a pre-v45 API must remove:

```text
api heartbeat state@eq
```

while a UI connected to v45 or newer must remove:

```text
is connected to vpn@eq
```

Hard-coding both field names into `STRUCTURED_FILTER_KEYS` is not equivalent: the configured API version should determine which field represents the semantic "online status" for that deployment.

#### Connectivity filter values

The v45 compatibility change also changes the **type and meaning of the filter value**, so resolving the field name alone is not sufficient.

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
'online' | 'offline' | 'all'
```

must be serialized differently according to the resolved compatibility field.

Conceptually:

```ts
const usesVpnConnectivity =
  deviceOnlineStatus === 'is connected to vpn';

listFilters[deviceOnlineStatusFilter] = usesVpnConnectivity
  ? filters.onlineStatus === 'online'
  : filters.onlineStatus;
```

Similarly, when converting a react-admin filter back into the structured UI state, pre-v45 code interprets string heartbeat states while v45+ code interprets boolean VPN connectivity.

The version map is responsible for selecting the **field name**. Code using that field remains responsible for handling differences in the field's **value semantics**.

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

Likewise, do not normalize API objects by deleting old properties and adding new properties merely to make newer UI code work against older API versions.

Instead, resolve the API-specific name once:

```ts
const isPinnedOnRelease = versions.resource(
  'isPinnedOnRelease',
  environment.REACT_APP_OPEN_BALENA_API_VERSION,
);

const deviceOnlineStatus = versions.field(
  'deviceOnlineStatus',
  environment.REACT_APP_OPEN_BALENA_API_VERSION,
);
```

and use those resolved names wherever the corresponding concept is accessed.

This provides one source of truth for API-version differences and prevents different parts of the UI from making different assumptions about the same API release.

### Adding compatibility for future API changes

When a newer `open-balena-api` release changes a resource, field, or the semantics the UI depends on:

1. Determine the **exact tagged `open-balena-api` release** where the relevant change becomes applicable. Do not use the `/v6` or `/v7` API generation as the compatibility boundary.
2. Inspect the `open-balena-api` commit history, changelog, SBVR model, and migrations as necessary. API migrations are often staged across several releases, so distinguish between when a new field is introduced, when it becomes authoritative, and when the old field is actually removed.
3. Add a semantic alias to the oldest supported mapping if the UI needs to refer to the concept across the entire supported version range.
4. Add a new version entry at the appropriate change point, inheriting the preceding `resources`, `fields`, and `translations` maps and overriding only the values that changed.
5. Access the concept through `versions.resource()` or `versions.field()` throughout the UI rather than introducing component-specific version checks or rewriting API records.
6. If the change also alters the type or meaning of the value—as with heartbeat strings versus VPN booleans—handle that conversion at the point where the value is interpreted or serialized. A field-name mapping by itself does not perform value conversion.
7. Preserve compatibility with the existing v0.139.0 minimum unless the project's documented minimum supported `open-balena-api` version is intentionally changed.

A new mapping should be added only when the UI needs different behavior starting with that particular `open-balena-api` release.

The compatibility layer is intended to allow the current `open-balena-ui` codebase to operate against both older supported OpenBalena installations and current `open-balena-api` releases without scattering version-specific SBVR knowledge throughout the application.

Operational data uses the backwards-compatible OData v6 endpoint on older servers and v7 where supported, and accepts
both legacy and current OData response envelopes. See [API_VERSIONS.md](API_VERSIONS.md) for the provider's compatibility
and degradation behavior and [ACCESS_CONTROLS.md](ACCESS_CONTROLS.md) for administrator role setup and PostgREST security
requirements.

## Installation

Ensure you are running Node.js 24 or newer locally to match the production image and CI configuration.

Set the required environment variables accordingly, and run `npm run start` from the main project folder. If running
locally, you can access `open-balena-ui` via your web browser at `http://localhost:PORT`, and provided the configuration
environment variables are appropriately pointed to live `open-balena-api` and `open-balena-postgrest` instances, you
should be up and running.

## Development

For local development, the Vite dev server exposes two modes:

- `npm run dev` launches with the `devprod` mode configuration (mirroring hosted settings).
- `npm run dev:local` loads the `local` mode configuration for working against local services.

When you need a production-like client build, run `npm run build:client` (or `npm run build` to bundle both client and
server) followed by `npm run serve` to boot the compiled Express server.

## Credits

- The [ra-data-postgrest](https://github.com/raphiniert-com/ra-data-postgrest) project was instrumental in establishing
  the link to the open-balena database

## Legacy Items

- **Expanded Vite config**: The configuration keeps legacy behavior from the original webpack/CRA setup—explicit aliases
  and polyfills for the Node-style modules above, plus tailored build/preview settings so the Express server can serve
  the SPA exactly as before.
