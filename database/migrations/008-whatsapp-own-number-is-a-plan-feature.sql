-- ===========================================================================
--  MIGRATION 008 — "USE YOUR OWN WHATSAPP NUMBER" BECOMES A PLAN FEATURE
-- ===========================================================================
--
--      npm run db:migrate
--
--  THE LEAK THIS CLOSES
--  --------------------
--  whatsappAllowance() in lib/whatsapp.js answered the own-number case BEFORE it
--  looked at the plan:
--
--      if (usesOwnNumber(clinic)) return { enabled: true, unlimited: true, ... }
--
--  So `plans.whatsapp_enabled` was never consulted for a clinic that had connected
--  its own number. Two consequences, both bad for the business:
--
--    1. A Starter clinic (₹499, WhatsApp NOT included) got unlimited WhatsApp for
--       free simply by connecting a number. The paid feature was optional.
--
--    2. A Professional clinic needing 2,000 messages had no reason to move to the
--       ₹2,999 plan. Connecting its own number was cheaper than upgrading, so the
--       quota created no upgrade pressure at all — which is the entire mechanism
--       the pricing depends on.
--
--  The reasoning in that early-return was sound as far as it went: a clinic paying
--  Meta directly should not also be rationed by us. What it missed is that WHOSE
--  NUMBER SENDS is a delivery detail, and WHETHER THE CLINIC MAY USE WHATSAPP AT
--  ALL is a licensing question. Conflating the two gave away the licence.
--
--  WHY THIS IS THE RIGHT SHAPE AND NOT JUST A CAP
--  ---------------------------------------------
--  The alternative was to ration own-number clinics too. That would be charging
--  them twice — once by Meta for the message, once by us for permission — and it
--  makes the product worse at no benefit, because those messages cost us nothing.
--
--  Making own-number a feature of the TOP plan instead keeps every incentive
--  pointing the right way:
--
--      Starter        no WhatsApp                     → upgrade to get it
--      Professional   500/month on our number         → upgrade when 500 is not enough
--      Clinic         2,000/month, or your own number  → the ceiling, and unlimited
--
--  A clinic sending thousands of messages a month is a clinic large enough to be on
--  the top plan. That is who own-number is for.
-- ===========================================================================


ALTER TABLE plans
  ADD COLUMN whatsapp_own_number TINYINT(1) NOT NULL DEFAULT 0
    AFTER whatsapp_monthly_quota;

-- The top plan only. A clinic big enough to want its own number and its own Meta
-- bill is a clinic big enough for ₹2,999.
UPDATE plans SET whatsapp_own_number = 1 WHERE code = 'clinic';

-- Belt and braces on the tier below: Professional pays for a quota, and the quota
-- is the point. Stated explicitly rather than left to the column default, so a
-- future plan added by copying this row does not inherit a surprise.
UPDATE plans SET whatsapp_own_number = 0 WHERE code IN ('starter', 'professional');
