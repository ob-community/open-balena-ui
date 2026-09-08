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
- **First `global-admin` role created through this UI:** only the user configured by `OPEN_BALENA_BOOTSTRAP_USER_ID` may
  create it, and the proxy automatically assigns it to that user.
- **`global-admin` role exists:** direct database authorization is enforced for every request.

Before activation, protected administrator roles cannot be renamed into existence or assigned through the proxy. Create
`organization-admin` only after the bootstrap user has activated `global-admin`.

Set `OPEN_BALENA_BOOTSTRAP_USER_ID` to a trusted existing user before activation. If it is unset, seed and assign the
role using a trusted database-administration channel instead. Create and assign at least two global administrators
before relying on enforcement. Deleting the last global-admin assignment can lock administrators out even though the
role still exists.

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

Credential fields are also rejected in query parameters to prevent filter-based inference. Generic PATCH requests cannot
modify user password/JWT-secret fields or API-key material.

## Deployment checklist

1. Configure `OPEN_BALENA_JWT_SECRET` on the UI server.
2. Configure internal-only `OPEN_BALENA_POSTGREST_URL`.
3. Set `OPEN_BALENA_BOOTSTRAP_USER_ID` to the trusted user that will activate enforcement.
4. Remove public ingress and browser access to PostgREST.
5. Upgrade the UI while no `global-admin` role exists; verify legacy administration still works.
6. Sign in as the bootstrap user, create `global-admin`, and confirm the creator receives the role.
7. Assign a second global administrator.
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
