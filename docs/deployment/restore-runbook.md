# Runbook — Database Restore

**Referenced from:** `DEPLOYMENT.md` §7 · **Last rehearsed:** never (see §6)

> A backup that has never been restored is not a backup. It is an untested assumption.

---

## 1. When to use this

- Data loss or corruption in production.
- Recovery to a point in time before a bad migration or bad data backfill.
- The **quarterly rehearsal** (§6), which is the reason this document stays accurate.

## 2. Before you start

- [ ] Declare an incident and open a channel (`DEPLOYMENT.md` §9).
- [ ] Identify the **target timestamp** — the last known-good moment. Getting this wrong
      costs a second restore.
- [ ] Decide the goal: full production restore, or a side-by-side restore for extraction?
      **Prefer side-by-side.** Restoring over production destroys the evidence needed to
      understand what happened.
- [ ] Confirm who is making the promotion decision. Not the person running the commands.

## 3. Restore procedure

```bash
# 1. Provision an ISOLATED instance. Never restore over production first.
#    Same major version (PostgreSQL 18), same extensions (citext, pg_trgm).

# 2. Restore the base backup
pg_basebackup -D /restore/data -h <backup-host> -U <backup-user> -X stream

# 3. Configure point-in-time recovery
cat >> /restore/data/postgresql.conf <<'CONF'
restore_command = '<the archive retrieval command for this environment>'
recovery_target_time = '2026-09-20 14:00:00+00'
recovery_target_action = 'promote'
CONF
touch /restore/data/recovery.signal

# 4. Start and let WAL replay complete. Watch the log until recovery finishes.
pg_ctl -D /restore/data start
```

## 4. Verification — do not skip

Run every check. A restore that *starts* is not a restore that is *correct*.

```sql
-- Row counts against expectation
SELECT 'users' t, count(*) FROM users
UNION ALL SELECT 'workspaces', count(*) FROM workspaces
UNION ALL SELECT 'vehicles',   count(*) FROM vehicles
UNION ALL SELECT 'service_records', count(*) FROM service_records;

-- How far did we actually recover?
SELECT max(created_at) FROM audit_logs;

-- Referential integrity across the tenant boundary:
-- a child whose workspace disagrees with its parent means a corrupt restore.
SELECT count(*) FROM service_records s
  JOIN vehicles v ON v.id = s.vehicle_id
 WHERE s.workspace_id <> v.workspace_id;      -- MUST be 0

-- Migration state matches the application version being deployed
SELECT migration_name, finished_at FROM _prisma_migrations
 ORDER BY finished_at DESC LIMIT 5;
```

- [ ] Row counts plausible for the target timestamp
- [ ] Latest `audit_logs` timestamp at or just before the target
- [ ] Tenant integrity query returns **0**
- [ ] Migration state matches the application version
- [ ] Point a staging API at the restored database and run the smoke suite
- [ ] Spot-check one real workspace: vehicle → services → documents chain intact

## 5. Promotion

Only after §4 is fully green, and only with the named decision-maker's approval.

1. Put the API into maintenance mode.
2. Repoint `DATABASE_URL` to the restored instance.
3. Verify `/health/ready`.
4. Reconcile object storage: documents referenced by restored rows must still exist.
   Rows whose objects are gone are set to `QUARANTINED`, not silently broken.
5. Re-enable traffic, then watch error rate and queue depth for 30 minutes.
6. **Reconcile the queues.** Jobs enqueued after the target timestamp are lost from
   Postgres's perspective but may still exist in Redis. Run the nightly reminder and usage
   reconciliation sweeps manually before trusting either.
7. Write the postmortem within 5 working days.

## 6. Quarterly rehearsal

Restore the most recent nightly backup to an isolated instance, run §4, record the result,
and destroy the instance. **Record every rehearsal below, including failures** — a
rehearsal that found a problem is the most valuable entry in this table.

| Date | Performed by | Backup restored | RTO achieved | RPO achieved | Result | Issues found |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | Not yet rehearsed | — |

**Targets:** RPO ≤ 5 minutes · RTO ≤ 2 hours.

If a rehearsal misses a target or finds a problem, raise a `HARD-006` follow-up task
before the next release.
