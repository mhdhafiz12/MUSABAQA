begin;

-- Keep the database constraint aligned with the five schedule blocks exposed
-- by the application. This migration does not modify any program records.
alter table public.programs
  drop constraint if exists programs_session_check;

alter table public.programs
  add constraint programs_session_check
  check (session in ('subahi','morning','afternoon','evening','night'));

commit;
