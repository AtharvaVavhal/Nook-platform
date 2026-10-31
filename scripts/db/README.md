# Database role provisioning

Role provisioning is deliberately separate from Prisma migrations because roles
are cluster-scoped and may not exist on a fresh database.

The provisioning operator must use an approved migrator role to own the nine
Phase 2 tables. The runtime application role must own no tables and receive only
the reviewed least-privilege grant matrix. Runtime access to `audit_events` is
limited to `INSERT` and `SELECT`; runtime `UPDATE` and `DELETE` are not granted.
Business-table deletion and session deletion are not granted by default.

No production role names, passwords or credentials are stored in this repository.
The exact non-audit grant matrix, role names and secret-delivery procedure must
be reviewed before execution. See [provision_roles.sql](./provision_roles.sql)
for the non-executable review template.
