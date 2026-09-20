-- ===========================================================================
--  KOKLI — SEED DATA
-- ===========================================================================
--  Run AFTER schema.sql. `npm run db:setup` does both in the right order.
--
--  This file seeds two very different things, and the split matters:
--
--    PART 1  PLATFORM data — your pricing plans. Every clinic sees these.
--    PART 2  TENANT data   — one demo clinic's services and timetable, so the
--                            app has something to show on first run.
--
--  The user accounts are NOT created here. They are created by
--  scripts/setup-db.js, because passwords must be hashed with bcrypt and SQL
--  cannot do that.
-- ===========================================================================

USE physio_clinic;


-- ###########################################################################
--  PART 1 — PLATFORM: the plans you sell
-- ###########################################################################
--
--  Priced deliberately below international clinic software to win the first
--  customers in India. These are starting prices — you will raise them once you
--  have testimonials, and because they live here rather than in code, that is a
--  form field in the platform admin, not a deployment.
--
--  Note where video sits. It is the strongest reason to choose this product over
--  a paper diary, AND it costs you real money in TURN relay bandwidth. So it is
--  the line between Starter and Professional: it is what makes people upgrade,
--  and it is what needs to cover its own costs.
-- ###########################################################################

INSERT INTO plans
  (code, name, tagline, price_paise, billing_period, trial_days,
   max_physios, max_locations, max_appointments_per_month,
   video_enabled, soap_notes_enabled, whatsapp_enabled, analytics_enabled,
   highlights, sort_order)
VALUES

('starter',
 'Starter',
 'For a single physiotherapist getting online.',
 49900, 'monthly', 30,
 1, 1, 0,
 0, 1, 0, 0,
 JSON_ARRAY(
   'Your own booking website',
   '1 physiotherapist',
   'Unlimited appointments',
   'Online payments into your own account',
   'Patient records & clinical notes',
   'Automatic SEO for your city'
 ),
 1),

('professional',
 'Professional',
 'Add online video consultations and grow beyond your postcode.',
 129900, 'monthly', 30,
 3, 1, 0,
 1, 1, 1, 0,
 JSON_ARRAY(
   'Everything in Starter',
   'One-to-one video consultations',
   'Up to 3 physiotherapists',
   'Home exercise programmes',
   'WhatsApp appointment reminders',
   'Priority email support'
 ),
 2),

('clinic',
 'Clinic',
 'For multi-therapist practices that need the full picture.',
 299900, 'monthly', 30,
 10, 5, 0,
 1, 1, 1, 1,
 JSON_ARRAY(
   'Everything in Professional',
   'Up to 10 physiotherapists',
   'Up to 5 locations',
   'Revenue & retention analytics',
   'Bulk patient export',
   'Phone support'
 ),
 3);


-- ###########################################################################
--  PART 2 — TENANT: the demo clinic
-- ###########################################################################
--  scripts/setup-db.js has already created the clinic row and its users. This
--  section fills in what that clinic sells and when it works.
--
--  Everything below is scoped with @clinic_id, which is exactly the discipline
--  every query in the application follows.
-- ###########################################################################

SET @clinic_id := (SELECT id FROM clinics WHERE slug = 'aarogya' LIMIT 1);
SET @physio_id := (SELECT id FROM users WHERE clinic_id = @clinic_id AND role = 'physio' ORDER BY id LIMIT 1);


-- ---------------------------------------------------------------------------
--  SERVICES
-- ---------------------------------------------------------------------------
--  Real physiotherapy services with realistic Indian pricing.
--
--  Two things worth noticing:
--
--  * available_online = 0 on dry needling and vertigo treatment. These need the
--    physio's hands (needles, and the Epley repositioning manoeuvre). Being
--    honest about that is better medicine and better business than taking money
--    for something that cannot work over a video call.
--
--  * Prices are in PAISE. ₹800 is written as 80000.
-- ---------------------------------------------------------------------------
INSERT INTO services
  (clinic_id, slug, name, short_description, description, icon, duration_minutes,
   price_paise, available_online, available_clinic, conditions_treated,
   what_to_expect, seo_title, seo_description, sort_order)
VALUES

(@clinic_id, 'initial-assessment',
 'Initial Assessment & Treatment Plan',
 'A full 60-minute first visit: we find the actual cause of your pain and give you a written plan.',
 'Your first appointment is the most important one. We take a detailed history of how the problem started, screen for anything that needs a doctor rather than a physiotherapist, then measure your movement, strength, joint range and posture properly. You leave knowing three things: what is wrong, how long it should take to fix, and exactly what to do before your next visit. If physiotherapy is not the right answer for your problem, we will tell you that and refer you on.',
 'ClipboardList', 60, 100000, 1, 1,
 JSON_ARRAY('Undiagnosed pain', 'Second opinion', 'Recurring injury', 'Post-imaging review'),
 JSON_ARRAY('Detailed history and red-flag screening', 'Physical examination and movement testing', 'Clear explanation of the diagnosis', 'Written treatment plan with a session estimate', 'First set of home exercises'),
 'Physiotherapy Assessment in Pune | 60-Minute First Consultation',
 'Book a thorough 60-minute physiotherapy assessment in Pune. Get a real diagnosis, a written treatment plan and your first home exercise programme.',
 1),

(@clinic_id, 'back-and-neck-pain',
 'Back & Neck Pain Relief',
 'Targeted treatment for slipped discs, sciatica, cervical spondylosis and the everyday ache of desk work.',
 'Back and neck pain is the single most common reason people come to us, and the vast majority get better without injections or surgery. We combine hands-on manual therapy and spinal mobilisation to settle the pain quickly, then build the deep core and neck stabiliser strength that stops it coming back. If your pain is coming from how you sit for nine hours a day, we fix that too — there is no point treating a problem every fortnight while its cause stays untouched.',
 'Activity', 45, 80000, 1, 1,
 JSON_ARRAY('Lower back pain', 'Sciatica', 'Slipped / herniated disc', 'Cervical spondylosis', 'Text neck', 'Sacroiliac joint pain', 'Postural back pain'),
 JSON_ARRAY('Spinal assessment and nerve screening', 'Manual therapy and mobilisation', 'Dry needling for muscle spasm if needed', 'Core and postural strengthening', 'Workstation advice you can apply the same day'),
 'Back Pain & Neck Pain Physiotherapy in Pune | Sciatica & Disc Treatment',
 'Relief from back pain, sciatica, slipped disc and neck pain in Pune. Manual therapy plus a strengthening plan that stops the pain returning. Online consults available.',
 2),

(@clinic_id, 'sports-injury-rehab',
 'Sports Injury Rehabilitation',
 'Get back to your sport properly — with strength and confidence, not just an absence of pain.',
 'Returning to sport too early is how one injury becomes a recurring one. We take you through the full pathway: settle the acute injury, restore range of motion, rebuild strength through the whole chain, then progress to sport-specific plyometrics and change-of-direction work. You are cleared to return when you pass objective strength and hop tests, not when the calendar says so.',
 'Trophy', 60, 100000, 1, 1,
 JSON_ARRAY('Ankle sprain', 'ACL / meniscus injury', 'Hamstring strain', 'Tennis and golfer''s elbow', 'Rotator cuff injury', 'Shin splints', 'Runner''s knee'),
 JSON_ARRAY('Injury grading and healing-stage assessment', 'Progressive loading programme', 'Sport-specific movement retraining', 'Objective return-to-play testing', 'Injury prevention programme'),
 'Sports Injury Physiotherapy in Pune | ACL, Ankle & Shoulder Rehab',
 'Sports injury rehabilitation in Pune for ACL tears, ankle sprains, hamstring strains and shoulder injuries. Objective return-to-play testing, not guesswork.',
 3),

(@clinic_id, 'post-surgery-rehab',
 'Post-Surgical Rehabilitation',
 'Structured week-by-week recovery after knee replacement, ACL repair, spine or shoulder surgery.',
 'A good surgeon does half the job; the other half is rehabilitation, and the window for it is narrower than most people realise. We follow your surgeon''s protocol precisely, respecting tissue-healing timelines while making sure you do not lose range of motion or muscle in the early weeks when it is easiest to lose both. You get a printed week-by-week programme so you always know what stage you should be at.',
 'HeartPulse', 60, 100000, 1, 1,
 JSON_ARRAY('Total knee replacement (TKR)', 'Total hip replacement (THR)', 'ACL reconstruction', 'Rotator cuff repair', 'Spinal fusion / discectomy', 'Fracture fixation'),
 JSON_ARRAY('Review of your surgeon''s protocol and reports', 'Swelling and scar management', 'Safe, staged range-of-motion work', 'Progressive strengthening and gait retraining', 'Week-by-week written milestones'),
 'Post-Surgery Physiotherapy in Pune | Knee Replacement & ACL Rehab',
 'Post-operative physiotherapy in Pune after knee replacement, ACL reconstruction, hip replacement or spine surgery. Surgeon-aligned, week-by-week rehab plans.',
 4),

(@clinic_id, 'frozen-shoulder',
 'Frozen Shoulder & Shoulder Pain',
 'Regain a shoulder that reaches overhead, fastens a blouse and sleeps through the night.',
 'Frozen shoulder (adhesive capsulitis) is slow, painful and genuinely frightening for the people who have it — and it is very treatable with patience. Treatment is matched to the stage you are in: pain relief and gentle movement while the shoulder is still irritable, then firm capsular stretching and joint mobilisation once it can tolerate them. Diabetics are far more prone to it and typically need longer, which we will discuss honestly at the assessment.',
 'RotateCw', 45, 85000, 1, 1,
 JSON_ARRAY('Frozen shoulder / adhesive capsulitis', 'Rotator cuff tendinopathy', 'Shoulder impingement', 'Bursitis', 'Biceps tendinitis'),
 JSON_ARRAY('Staging of the condition', 'Joint mobilisation and capsular stretching', 'Heat, ultrasound or TENS for pain relief', 'Home stretching programme with a clear schedule', 'Sleep-position advice'),
 'Frozen Shoulder Treatment in Pune | Shoulder Pain Physiotherapy',
 'Frozen shoulder and shoulder pain physiotherapy in Pune. Stage-matched joint mobilisation and stretching to restore full overhead movement.',
 5),

(@clinic_id, 'knee-osteoarthritis',
 'Knee Pain & Arthritis Care',
 'Strong legs beat painkillers. Delay or avoid a knee replacement with the right loading programme.',
 'Knee osteoarthritis is not simply wear and tear that you have to accept. Cartilage responds to load, and the single best-evidenced treatment for arthritic knee pain is progressive strengthening of the muscles around the joint — better than most injections, and it does not wear off. We also look at your hips, ankles and how you walk, because knee pain very often starts somewhere else.',
 'Footprints', 45, 85000, 1, 1,
 JSON_ARRAY('Knee osteoarthritis', 'Patellofemoral pain', 'Meniscal degeneration', 'Chondromalacia patellae', 'Knee stiffness'),
 JSON_ARRAY('Gait and lower-limb alignment analysis', 'Quadriceps and hip strengthening', 'Manual therapy for joint stiffness', 'Load management and weight advice', 'Bracing and footwear guidance'),
 'Knee Pain & Arthritis Physiotherapy in Pune | Avoid Knee Replacement',
 'Knee osteoarthritis physiotherapy in Pune. Evidence-based strengthening to reduce pain and delay knee replacement surgery. Book online or in clinic.',
 6),

(@clinic_id, 'dry-needling',
 'Dry Needling & Myofascial Release',
 'Fast release for stubborn muscle knots and trigger points that stretching will not touch.',
 'When a muscle has been in spasm for months, a tight band forms that stretching alone rarely releases. Dry needling puts a very fine sterile needle directly into that trigger point to make it let go — most people feel a deep twitch and then noticeable relief within minutes. It is not acupuncture: there is no traditional-medicine theory behind it, just anatomy. Expect mild soreness for a day afterwards, similar to after a hard workout.',
 'Zap', 30, 70000, 0, 1,
 JSON_ARRAY('Myofascial trigger points', 'Chronic muscle spasm', 'Tension headaches', 'Plantar fasciitis', 'Tennis elbow', 'Calf and hamstring tightness'),
 JSON_ARRAY('Trigger point mapping', 'Sterile single-use needling', 'Myofascial and soft tissue release', 'Post-treatment stretching', 'Aftercare advice'),
 'Dry Needling in Pune | Trigger Point & Myofascial Release Therapy',
 'Dry needling and myofascial release in Pune for chronic muscle knots, trigger points, tension headaches and plantar fasciitis. In-clinic treatment.',
 7),

(@clinic_id, 'neuro-rehab',
 'Neurological Rehabilitation',
 'Relearning movement after a stroke, or living well with Parkinson''s and other neurological conditions.',
 'The nervous system can rewire itself — that is neuroplasticity, and it is the entire basis of neurological rehabilitation. Progress is measured in months rather than weeks, and it depends heavily on repetition done correctly and consistently. We work on the practical things that give independence back: standing up from a chair, walking safely, using an affected hand, managing balance. Family members are taught the handling techniques too, because they are with the patient every day and we are not.',
 'Brain', 60, 120000, 1, 1,
 JSON_ARRAY('Stroke / hemiplegia', 'Parkinson''s disease', 'Multiple sclerosis', 'Bell''s palsy', 'Spinal cord injury', 'Peripheral neuropathy', 'Cerebral palsy'),
 JSON_ARRAY('Neurological and functional assessment', 'Task-specific movement retraining', 'Balance and gait training', 'Spasticity management', 'Caregiver training and home-safety advice'),
 'Neuro Physiotherapy in Pune | Stroke & Parkinson''s Rehabilitation',
 'Neurological physiotherapy in Pune for stroke, Parkinson''s disease, multiple sclerosis and Bell''s palsy. Functional rehabilitation plus caregiver training.',
 8),

(@clinic_id, 'posture-ergonomics',
 'Posture Correction & Desk Ergonomics',
 'Built for people who sit nine hours a day. Ideal as an online consultation.',
 'If you work at a laptop, your body is adapting to that position whether you like it or not — rounded shoulders, a forward head, a stiff mid-back and hips that have forgotten how to extend. This is the one service where an online consultation is arguably better than coming in, because we can see your actual desk, your actual chair and your actual screen height, and fix them on the spot. Then you get a five-minute daily routine that genuinely fits into a working day.',
 'PersonStanding', 45, 70000, 1, 1,
 JSON_ARRAY('Forward head posture', 'Rounded shoulders', 'Upper back and trapezius pain', 'Work-from-home neck pain', 'Repetitive strain injury', 'Wrist and mouse-hand pain'),
 JSON_ARRAY('Postural photo and movement screening', 'Live review of your actual workstation', 'Corrective mobility and strength exercises', 'A five-minute daily desk routine', 'Follow-up progress check'),
 'Posture Correction & Ergonomics Physiotherapy Online | Desk Neck Pain',
 'Online posture correction and desk ergonomics physiotherapy. Fix work-from-home neck pain, rounded shoulders and forward head posture from your own desk.',
 9),

(@clinic_id, 'prenatal-postnatal',
 'Prenatal & Postnatal Physiotherapy',
 'Safe, gentle care through pregnancy and proper recovery of core and pelvic floor afterwards.',
 'Pregnancy changes load, posture and ligament laxity all at once, and back or pelvic pain is common rather than inevitable. We teach safe exercise through each trimester, treat pelvic girdle and back pain hands-on, and prepare you for labour positioning. Afterwards — including after a caesarean — we rebuild the deep core and pelvic floor in the right order, which is what prevents the leaking, the doming tummy and the back pain that many women are wrongly told to simply live with.',
 'Baby', 45, 90000, 1, 1,
 JSON_ARRAY('Pregnancy back pain', 'Pelvic girdle pain', 'Diastasis recti (abdominal separation)', 'Pelvic floor weakness', 'Post-caesarean recovery', 'Postnatal core rehabilitation'),
 JSON_ARRAY('Trimester-appropriate assessment', 'Safe exercise prescription', 'Manual therapy for pelvic and back pain', 'Pelvic floor and deep core retraining', 'Labour positioning and breathing guidance'),
 'Prenatal & Postnatal Physiotherapy in Pune | Pelvic Floor & Diastasis Recti',
 'Pregnancy and postnatal physiotherapy in Pune. Safe prenatal exercise, pelvic girdle pain relief, diastasis recti and pelvic floor rehabilitation.',
 10);


-- ---------------------------------------------------------------------------
--  AVAILABILITY — the physiotherapist's weekly working pattern
-- ---------------------------------------------------------------------------
--  weekday: 0 = Sunday, 1 = Monday … 6 = Saturday (same as JS getDay()).
--
--  Notice the split shift on weekdays — a morning clinic, a break, then an
--  evening clinic. That is how physiotherapy clinics in India actually run,
--  because patients come before or after work.
--
--  Sunday is online-only: a real clinic often keeps a short remote window for
--  follow-ups without opening the premises.
-- ---------------------------------------------------------------------------
INSERT INTO availability_rules (clinic_id, physio_id, weekday, start_time, end_time, slot_minutes, mode) VALUES
  (@clinic_id, @physio_id, 1, '09:00:00', '13:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 1, '16:00:00', '20:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 2, '09:00:00', '13:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 2, '16:00:00', '20:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 3, '09:00:00', '13:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 3, '16:00:00', '20:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 4, '09:00:00', '13:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 4, '16:00:00', '20:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 5, '09:00:00', '13:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 5, '16:00:00', '20:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 6, '09:00:00', '16:00:00', 30, 'both'),
  (@clinic_id, @physio_id, 0, '10:00:00', '13:00:00', 30, 'online');


-- ---------------------------------------------------------------------------
--  SUBSCRIPTION — put the demo clinic on a Professional trial
-- ---------------------------------------------------------------------------
--  Professional rather than Starter so that video consultations are switched on
--  out of the box and the whole product can be explored on a fresh install.
-- ---------------------------------------------------------------------------
SET @plan_id := (SELECT id FROM plans WHERE code = 'professional' AND billing_period = 'monthly' LIMIT 1);
SET @trial_days := (SELECT trial_days FROM plans WHERE id = @plan_id);

INSERT INTO subscriptions
  (clinic_id, plan_id, status, price_paise, billing_period, trial_ends_at,
   current_period_start, current_period_end)
VALUES
  (@clinic_id, @plan_id, 'trialing',
   (SELECT price_paise FROM plans WHERE id = @plan_id),
   'monthly',
   DATE_ADD(NOW(), INTERVAL @trial_days DAY),
   NOW(),
   DATE_ADD(NOW(), INTERVAL @trial_days DAY));
