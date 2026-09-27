# Direct database access

Open Balena Admin uses two data backends behind one react-admin data provider:

1. **open-balena-api OData** is the default for operational resources, using v6 or v7 according to the configured server
   version.
2. **open-balena-postgrest** is an explicit exception for administrator-only identity and authorization data.

The routing table lives in `src/dataProvider/openBalenaDataProvider.ts`. A resource that is absent from both allowlists
fails closed. It must never silently fall back to PostgREST.

## Why API access is the default

open-balena-api applies PineJS permissions, validation, hooks, and side effects. PostgREST writes directly to PostgreSQL
and bypasses all of them. This is both a security risk and a behavioral difference.

For example, changing a device's target release through open-balena-api notifies an online supervisor immediately.
Changing the same row through PostgREST does not send that notification; the device only sees the change on a later
poll. Consequently, fleets, devices, releases, services, images, variables, tags, installs, and static device metadata
must use OData.

The provider uses OData v6 for servers older than v26.1.0 because it is available on the oldest supported
open-balena-api release (v0.139.0). It selects OData v7 on v26.1.0 and newer, enabling newer query behavior while the
existing UI compatibility mappings reduce functionality for older installations. `REACT_APP_OPEN_BALENA_ODATA_VERSION`
can override that selection, but this is separate from `REACT_APP_OPEN_BALENA_API_VERSION`, which is the server software
version.

The hybrid provider advertises React Admin abort-signal support for read queries. React Admin 5.15 does not synthesize
abort signals for standard mutations, so standard create, update, and delete operations are not described as
cancellable. Dedicated provider actions accept an explicitly typed `AbortSignal`; callers that expose cancellation must
create and pass that signal themselves.

## Why PostgREST is still required

open-balena-api deliberately does not expose every internal authentication resource with global-administrator semantics.
In particular, user credentials are not a public OData resource, and API keys are scoped so that even an administrator
cannot enumerate every user's keys. The UI also needs to manage the underlying actors, roles, permissions, memberships,
and join tables as a coordinated administrative operation.

The direct-access allowlist is therefore limited to:

- actors and API keys;
- users, credentials, and public keys;
- roles and permissions;
- organizations and memberships;
- identity/authorization join tables;
- configuration and PineJS migration/model metadata already exposed by the legacy admin UI.

The `balena_os` system organization and its initial administrative membership are deployment bootstrap records because
open-balena-api does not expose organization creation. The Mapped Pulumi `Org` provider creates or adopts those records
through protected PostgREST. Host OS and Supervisor application, release, service, image, and device-target writes then
use open-balena-api exclusively.

Human-user API key material remains visible only to its owner. Fleet and device key material is visible to global
administrators and to organization administrators whose server-computed scope includes that fleet/device, because those
administrators must be able to create and maintain provisioning/device credentials. This distinction is enforced from
actor ownership in the `/admin-db` proxy rather than from client-supplied filters.

User creation is a server-only action that hashes the password, generates the JWT secret, and provisions the named-user
credential actor through PostgREST tables available on legacy installations. Device and fleet creation use a coordinated
server action that provisions the credential actor and then writes the operational record through open-balena-api. If
the API write fails, the server removes the newly created role assignment, API key, and actor. Additional API keys are
also created by a server action using cryptographically random material after validating the target actor. Human-user
key material is not returned to the administrator's browser.

User, fleet, and device deletion also uses a coordinated server action. A shared server preflight validates the parent
record, actor, administrator scope, and self-lockout rules before browser-side related-record cleanup begins; the final
action repeats the checks. If cleanup fails after the parent deletion, a global administrator may retry the action;
before deleting an orphaned actor, the server verifies that no user, fleet, or device still references it and deletes
its remaining API keys. API-key bulk deletion similarly uses one bounded server action rather than one rate-limited
browser request per selected key. Parent credential keys are removed only after the parent deletion succeeds. For user
deletion, relation rows are restored if the parent deletion fails.

These requests pass through the UI server's `/admin-db` authorization proxy and retain the authenticated JWT, but they
still **do not gain open-balena-api ACL enforcement**. The PostgREST service must not be publicly reachable. Deploy it
on an internal network, restrict database credentials to the required schema, use TLS, and audit all writes. See
`ACCESS_CONTROLS.md` for role activation, organization scope, and credential redaction.

## Adding or moving a resource

Before adding a direct-database resource:

1. Verify the resource and required operation cannot be performed through the oldest supported OData endpoint.
2. Check whether bypassing API hooks can leave devices, caches, or storage out of sync.
3. Add the resource explicitly to `DIRECT_DB_RESOURCES`.
4. Document the exact API limitation in this file and add routing tests.

When open-balena-api gains suitable administrator endpoints, remove the resource from the direct list, add it to the
OData map, and test its create/update/delete behavior. Never use automatic retry from an API authorization failure to
PostgREST: that would turn an ACL denial into an ACL bypass.

## Known limitations

Direct writes do not trigger API push notifications, hooks, or SBVR validation. Multi-step identity workflows are not
transactional across browser requests and can leave partial records if interrupted. These constraints predate the hybrid
provider; future server-side admin endpoints should replace these direct workflows.
