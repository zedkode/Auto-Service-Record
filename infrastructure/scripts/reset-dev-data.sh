#!/usr/bin/env bash
# Removes accounts and vehicles created by the verification scripts, leaving the seeded
# demo data intact. Local development only — it refuses to run against anything else.
set -euo pipefail

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "Refusing to run against production." >&2
  exit 1
fi

docker exec -i autoservices-postgres psql -U autoservices -d autoservices -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE tu AS
  SELECT id FROM users
  -- Every @example.com account, which is exactly the set the verification scripts
  -- create. example.com is reserved by RFC 2606 and can never be a real address, so
  -- this cannot match an account you registered yourself. It replaces a list of
  -- per-script prefixes that had to be extended every time a script was added — and
  -- silently left accounts behind whenever someone forgot.
  WHERE email LIKE '%@example.com';
CREATE TEMP TABLE tw AS SELECT id FROM workspaces WHERE owner_user_id IN (SELECT id FROM tu);

DELETE FROM odometer_entries  WHERE workspace_id IN (SELECT id FROM tw);
-- Ownership records and expenses hold the vehicle with ON DELETE RESTRICT, so they
-- go first.
-- Documents also hold the vehicle with ON DELETE RESTRICT. The objects behind them are
-- left in MinIO: reaping orphaned objects is DOC-108 and is not built, so this is
-- deliberately incomplete rather than silently pretending otherwise.
DELETE FROM documents             WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM expenses              WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM expense_categories    WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM inspection_advisories WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM vehicle_inspections   WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM insurance_policies    WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM road_tax_records      WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM notification_deliveries WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM notifications         WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM reminders             WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM maintenance_completions WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM maintenance_rules     WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM service_record_parts  WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM service_records       WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM service_categories    WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM vehicle_images        WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM vehicles          WHERE workspace_id IN (SELECT id FROM tw);
DELETE FROM audit_logs        WHERE workspace_id IN (SELECT id FROM tw) OR actor_user_id IN (SELECT id FROM tu);
DELETE FROM workspace_invitations WHERE workspace_id IN (SELECT id FROM tw)
   OR email LIKE '%@example.com';
DELETE FROM workspace_members WHERE workspace_id IN (SELECT id FROM tw) OR user_id IN (SELECT id FROM tu);
DELETE FROM workspaces        WHERE id IN (SELECT id FROM tw);
DELETE FROM sessions          WHERE user_id IN (SELECT id FROM tu);
DELETE FROM user_profiles     WHERE user_id IN (SELECT id FROM tu);
DELETE FROM users             WHERE id IN (SELECT id FROM tu);

-- Email history and suppressions belonging to the test accounts. Matched on the
-- recipient address rather than the user id, because a message deliberately outlives the
-- account it was sent to (email_messages.user_id is ON DELETE SET NULL) and would
-- otherwise accumulate forever in the operations console.
-- The @example.com restriction is what keeps real addresses out of this.
CREATE TEMP TABLE tm AS
  SELECT id FROM email_messages WHERE recipient_email LIKE '%@example.com';
DELETE FROM email_delivery_events WHERE email_message_id IN (SELECT id FROM tm);
DELETE FROM notification_deliveries WHERE email_message_id IN (SELECT id FROM tm);
DELETE FROM email_messages        WHERE id IN (SELECT id FROM tm);
DELETE FROM email_suppressions    WHERE email LIKE '%@example.com';
DELETE FROM audit_logs            WHERE resource_type IN ('email_webhook', 'email_suppression');

-- Service records the verification scripts created.
CREATE TEMP TABLE ts AS
  SELECT id FROM service_records
  WHERE title LIKE 'Brake fluid change %'
     OR workshop_name IN ('UI Test Garage', 'Smith & Sons Garage');

-- The expense a service projected must go with it, or it is orphaned in the ledger.
DELETE FROM expenses                WHERE source_type = 'SERVICE' AND source_record_id IN (SELECT id FROM ts);
DELETE FROM maintenance_completions WHERE service_record_id IN (SELECT id FROM ts);
DELETE FROM service_record_parts    WHERE service_record_id IN (SELECT id FROM ts);
DELETE FROM odometer_entries        WHERE source_record_id  IN (SELECT id FROM ts);
DELETE FROM service_records         WHERE id IN (SELECT id FROM ts);

-- Vehicles the UI verification added to the seeded garage. Odometer entries must go
-- first: the FK is ON DELETE RESTRICT because mileage history is evidence, not chaff
-- (DATABASE.md §5).
CREATE TEMP TABLE tv AS
  SELECT id FROM vehicles
  WHERE model LIKE 'V60 %'
     OR model LIKE 'Octavia'
     OR (manufacturer = 'Volvo' AND registration_number = 'PL17 VOL');

-- Reminder and notification rows reference vehicles and reminders; clear them first.
DELETE FROM notification_deliveries WHERE reminder_id IN (SELECT id FROM reminders WHERE vehicle_id IN (SELECT id FROM tv));
DELETE FROM notifications           WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM reminders               WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM maintenance_completions WHERE rule_id IN (SELECT id FROM maintenance_rules WHERE vehicle_id IN (SELECT id FROM tv));
DELETE FROM maintenance_rules   WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM service_record_parts WHERE service_record_id IN (SELECT id FROM service_records WHERE vehicle_id IN (SELECT id FROM tv));
DELETE FROM service_records      WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM documents             WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM expenses              WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM inspection_advisories WHERE inspection_id IN (SELECT id FROM vehicle_inspections WHERE vehicle_id IN (SELECT id FROM tv));
DELETE FROM vehicle_inspections   WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM insurance_policies    WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM road_tax_records      WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM odometer_entries WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM vehicle_images   WHERE vehicle_id IN (SELECT id FROM tv);
DELETE FROM audit_logs       WHERE resource_id IN (SELECT id FROM tv);
DELETE FROM vehicles         WHERE id IN (SELECT id FROM tv);

-- Support access grants belonging to test workspaces or test staff.
DELETE FROM support_access_grants WHERE workspace_id IN (SELECT id FROM tw)
   OR admin_user_id IN (SELECT id FROM admin_users WHERE email LIKE '%@example.com');

-- Staff accounts the verification scripts created, all on @example.com. A real admin
-- account (created with scripts/create-admin.mjs) is never matched.
DELETE FROM audit_logs WHERE actor_admin_id IN
  (SELECT id FROM admin_users WHERE email LIKE '%@example.com');
DELETE FROM admin_sessions WHERE admin_user_id IN
  (SELECT id FROM admin_users WHERE email LIKE '%@example.com');
DELETE FROM admin_users WHERE email LIKE '%@example.com';

-- Self-healing sweep: a projected expense whose source record no longer exists is an
-- orphan, and orphans inflate every total silently. This catches them however they were
-- created, rather than relying on each verification script to remember its own.
DELETE FROM expenses e
 WHERE e.source_record_id IS NOT NULL
   AND (
     (e.source_type = 'SERVICE'   AND NOT EXISTS (SELECT 1 FROM service_records    r WHERE r.id = e.source_record_id))
  OR (e.source_type = 'INSURANCE' AND NOT EXISTS (SELECT 1 FROM insurance_policies r WHERE r.id = e.source_record_id))
  OR (e.source_type = 'TAX'       AND NOT EXISTS (SELECT 1 FROM road_tax_records   r WHERE r.id = e.source_record_id))
   );
COMMIT;
SQL

echo "Development data reset. Seeded accounts and vehicles are untouched."
