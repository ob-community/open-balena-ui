# Administrator access controls

## Security boundary

Operational data uses open-balena-api and its PineJS ACLs. Identity and authorization resources that cannot be managed
through that API use a same-origin Express proxy at `/admin-db`. The browser is no longer given the PostgREST URL.

The proxy:

- verifies the open-balena JWT with `OPEN_BALENA_JWT_SECRET`;
- derives the caller from the signed token's user ID;
- resolves roles and organization membership server-side;
- adds server-controlled ID scope to PostgREST queries;
- rejects client projections, aliases, and relationship embedding so top-level scope and redaction cannot be bypassed;
- validates organization references in mutation bodies;
- redacts credentials before returning a response.

This only creates a meaningful boundary if PostgREST is network-restricted so browsers and untrusted clients cannot
reach it directly. Set `OPEN_BALENA_POSTGREST_URL` to an internal address and remove public ingress to PostgREST.
Database row-level security or restricted views/RPCs remain the preferred long-term defense in depth.

## Compatibility activation

Existing installations historically treated every authenticated UI user as a database administrator. To avoid an upgrade
lockout, enforcement activates only when a role named `global-admin` exists.

- **No `global-admin` role:** legacy authorization behavior is retained, but credential redaction is always active.
- **No `global-admin` role and `OPEN_BALENA_BOOTSTRAP_USER_ID` is set:** server startup creates the role and assigns it
  to that numeric user ID before accepting requests.
- **`global-admin` role exists:** direct database authorization is enforced for every request.

Before activation, protected administrator roles cannot be renamed into existence or assigned through the proxy. Create
`organization-admin` only after the bootstrap user has activated `global-admin`.

`OPEN_BALENA_BOOTSTRAP_USER_ID` is the positive numeric `user.id` value, not a username or email address. Startup
validates that it identifies exactly one existing user. Bootstrap is idempotent: while the setting remains present,
startup creates a missing role and repairs a missing assignment before opening the HTTP listener. This makes an
interrupted or concurrent startup recoverable without database functions. After a successful bootstrap, create a second
global administrator and remove `OPEN_BALENA_BOOTSTRAP_USER_ID` so startup no longer restores the bootstrap assignment.

The proxy prevents the enforcement role from being renamed or deleted after activation. Deleting the last global-admin
assignment through the proxy is also prevented: a global administrator cannot delete their own user record or remove or
rebind their own `global-admin` assignment. An external database administrator can still create a lockout by changing
these records directly, so direct database access must remain restricted.

## Roles

### `global-admin`

Users assigned this role can administer all direct-database resources. They still cannot:

- read any user's password hash or JWT secret;
- read API key material owned by another human user;
- read another user's public-key content (metadata remains visible);
- update passwords/JWT secrets or API key material through generic table PATCH operations.

Password changes and credential rotation must use dedicated actions.

### `organization-admin`

Once enforcement is active, users assigned this role can access records associated with organizations where they are
members. Scope includes:

- the organization and its memberships;
- member user metadata;
- actors for member users, organization fleets, and their devices;
- API-key metadata and assignment rows for those actors;
- API-key material for fleets and devices in the administered organization;
- user role, permission, SSH-key metadata, and direct-fleet-access rows for members.

Global role definitions, permissions, role-permission mappings, configuration, and migration/model metadata remain
global-admin-only.

Organization administrators may read, update, and delete existing scoped records and create scoped join records when
every referenced ID is already in scope. They can create API keys for existing in-scope fleet/device actors. They cannot
create users, actors, or organizations through the current direct-database workflow. Those workflows start with unscoped
records and require a future transactional server endpoint to bind the new records to an organization safely.

Only global administrators may assign `global-admin` or `organization-admin`, direct user permissions, or API-key
roles/permissions. Protected administrator-role assignments and global-administrator user records are excluded from
organization scope, preventing an organization administrator from promoting themselves or modifying a global admin.

Organization membership currently defines administrative scope. Assign `organization-admin` only to users who should
administer every member and fleet in each organization to which they belong.

### Ordinary users

After activation, users without either administrative role cannot access `/admin-db`, even if the underlying PostgREST
deployment would otherwise accept their JWT.

## Credential handling

Redaction is applied in both legacy and enforced modes:

| Data                             | Behavior                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| User `password`                  | Never returned                                                                           |
| User `jwt_secret` / `jwt secret` | Never returned                                                                           |
| Human user API key `key`         | Returned only when the key belongs to the authenticated user's actor                     |
| Fleet/device API key `key`       | Returned to global admins and organization admins authorized to manage that fleet/device |
| SSH `public key`                 | Returned only for the authenticated user's own key; other records expose metadata only   |

Credential fields are also rejected in query parameters to prevent filter-based inference. Generic user POST, PATCH, and
PUT requests cannot set password/JWT-secret fields, and generic mutations cannot change API-key material. PostgREST
upsert preferences are rejected so a create request cannot modify an existing out-of-scope record.

Password changes use the dedicated `/admin-db/actions/change-password` action. It allows users to change their own
password when they have administrator access and allows administrators to change only passwords for users within their
computed scope. Password hashing is performed on the UI server; generic user PATCH requests continue to reject password
changes.

User creation uses `/admin-db/actions/create-user`; password hashing, JWT-secret generation, and named-user credential
provisioning all occur on the UI server. Device and fleet creation use `/admin-db/actions/provision-credential-actor`.
These actions create actors, API keys, and role assignments through old-compatible PostgREST operations, with
best-effort cleanup after partial failures. Human credential material is never returned to the administrator's browser.
User creation and unbound actor provisioning are global-admin-only; organization administrators may create and maintain
additional keys only for existing fleet/device actors already in their organization scope.

## Deployment checklist

1. Configure `OPEN_BALENA_JWT_SECRET` on the UI server.
2. Configure internal-only `OPEN_BALENA_POSTGREST_URL`.
3. Set `OPEN_BALENA_BOOTSTRAP_USER_ID` to the trusted user's numeric ID.
4. Remove public ingress and browser access to PostgREST.
5. Start the UI and confirm startup created the role and assignment.
6. Assign a second global administrator.
7. Remove `OPEN_BALENA_BOOTSTRAP_USER_ID` and restart the UI.
8. Create `organization-admin` and assign it only to intended organization administrators.
9. Verify ordinary, organization-admin, and global-admin accounts separately.
10. Monitor denied `/admin-db` requests and audit direct-database writes.

## Limitations and future work

- Authorization metadata is read from PostgREST on each request; deployments may add a short, carefully invalidated
  cache if needed.
- Multi-step legacy identity workflows are not transactional.
- Organization-admin user creation is disabled until implemented as a server-side transaction.
- PostgreSQL RLS/restricted views should eventually enforce the same policy even if the proxy is bypassed.
- open-balena-api administrator endpoints should replace direct database access wherever they become available.
