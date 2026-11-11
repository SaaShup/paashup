-- The webhook delivery log was a disposable audit trail with no functional
-- dependents (no FKs, nothing reads it back) — dropped to stop accumulating rows.
-- Failed deliveries are still logged to the server's console/process logs.
DROP TABLE IF EXISTS extras_webhook_delivery;
