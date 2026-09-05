-- Opening rows for reservations that predate the ledger.
--
-- `green_lot_reservations` (0007) makes a lot's reserved weight derivable, and
-- the reconciliation job compares the two. Any reservation made before that
-- table existed has no rows behind it, so without this every one of them would
-- be reported as critical drift on the deploy that introduces the check —
-- dozens of alerts that are all the same fact, which is how an alerting system
-- gets muted.
--
-- This is the same move a lot already makes for its balance: created at zero,
-- then an opening row that accounts for what is there. `seq` is 1 because by
-- definition no other row exists for these lots.
--
-- Idempotent: only lots that hold a reservation and have no ledger at all.
INSERT INTO green_lot_reservations
  (org_id, green_lot_id, seq, delta_kg, reserved_before_kg, reserved_after_kg, reason)
SELECT l.org_id, l.id, 1, l.reserved_weight_kg, 0, l.reserved_weight_kg,
       'Opening balance: reserved before the reservation ledger existed'
  FROM green_lots l
 WHERE l.reserved_weight_kg <> 0
   AND NOT EXISTS (
     SELECT 1 FROM green_lot_reservations v WHERE v.green_lot_id = l.id
   );
