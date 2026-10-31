# TiDB schema inventory

## Repository-derived expected schema

The generated [database schema inventory](database-schema-inventory.md) currently reports 157 distinct table names across 82 numbered files in `schema/`. It records observed columns, primary keys, foreign keys, unique constraints, secondary indexes, migration provenance, and lexical runtime references. The [migration registry](tidb-migration-registry.md) classifies observed syntax and lists tables/index names for every numbered migration.

The generator does not perform SQL semantic analysis. It merges historical and current definitions by table name, so a later migration can change a type or drop/replace an index while the inventory still contains historical details. Runtime references are lexical source matches, not a complete query dependency graph. Review the migration files and source query attributions before using this inventory to plan DDL.

## Live TiDB schema verification

**Pending. No live TiDB connection or read-only metadata export was available for this stage.** No production identity, table list, columns, keys, indexes, constraints, missing objects, unexpected objects, or type mismatches are asserted here.

When authorized read-only access is available, run the existing readiness check with explicit TiDB selection and isolated production-read approval. Export `information_schema.TABLES`, `COLUMNS`, `STATISTICS`, `KEY_COLUMN_USAGE`, and `REFERENTIAL_CONSTRAINTS` for `osaahdaylightschool`; compare each result with the repository-derived expected schema. Store the output as a separate timestamped live report, redact host/user identifiers, and record TiDB server version and verification time. Do not make this generator write a live report without a successful identity check.
