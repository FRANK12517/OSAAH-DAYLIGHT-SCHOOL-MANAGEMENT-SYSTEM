# TiDB schema reconciliation — Phase 2B

> **Status: INCOMPLETE.** This repository evidence ledger does not authorize production initialization or claim live TiDB compatibility.

- Original application/historical tables: **159** (the five source-defined platform metadata tables are tracked outside this original count).
- Historical views tracked separately: **8**.
- Table classifications: {"ACTIVE_APPLICATION_TABLE":66,"ACTIVE_APPLICATION_VIEW":5,"HISTORICAL_OR_OBSOLETE":0,"SUPERSEDED":0,"DUPLICATE_OR_ALTERNATIVE":1,"UNRESOLVED":95}.
- Views: 5 supported-workflow candidates and 3 unresolved.
- Confirmed canonical application relationships: **0**; historical FK candidates: **400**.
- Confirmed canonical application indexes: **0**; historical index candidates: **175**.
- Complete authoritative application DDL definitions: **0**.
- Application modules mapped to active entities: **115**; modules with complete authoritative contracts: **0**.
- Runtime query references are traceable in the JSON ledger, but full dependency validation is blocked because no canonical column contract exists.

The classifications distinguish direct runtime dependencies, one legacy compatibility alternative, and objects for which current workflow evidence is insufficient. Historical candidates are preserved in the ledger. The required next decisions are domain-owner resolution of unresolved workflows and conflicts, approval of exact physical contracts and target TiDB version, then live comparison against a verified database.

The five metadata tables (`osaah_fresh_installations`, `schema_baselines`, `schema_migration_lock`, `schema_migration_runs`, `schema_migrations`) have source TiDB DDL, but have not been live-verified. They are platform infrastructure rather than members of the original 159 application/historical table set.

## Artifacts

- [Authoritative schema status](tidb-authoritative-schema.md)
- [Entity inventory](tidb-schema-entity-inventory.json)
- [Relationship evidence](tidb-schema-relationship-map.md)
- [Application coverage](tidb-application-schema-coverage.md)

The JSON ledger contains one entry for every original table and every historical view, with runtime modules, SQL references, migration provenance, lexical test references, relationship candidates, confidence, questions, and disposition. Test references identify literal object-name mentions and do not alone prove complete workflow coverage.
