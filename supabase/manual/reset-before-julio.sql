-- Reset Hassan's test data before Julio starts (HUMAN_GUIDE 6c/6d).
--
-- Run ONCE in the Supabase SQL Editor, AFTER finishing the 6c checks and
-- BEFORE sending Julio the link. It deletes every session, saved word and
-- usage count, and resets the profile, so his History, chart, repeat filter,
-- pause calibration and (step 7) placement start from his own first session.
--
-- Never run it after Julio has started: it would erase his progress too.
-- This is not a migration; it lives outside supabase/migrations on purpose.

delete from public.sessions;
delete from public.vocab;
delete from public.usage;
delete from public.case_flags;
update public.profile
  set level = 2, pause_p90 = null, placement_done = false, updated_at = now()
  where id = 1;

-- Check: every count should be 0, and the profile back to level 2 with no pause_p90.
select
  (select count(*) from public.sessions) as sessions,
  (select count(*) from public.vocab) as vocab,
  (select count(*) from public.usage) as usage,
  (select to_jsonb(p) from public.profile p where id = 1) as profile;
