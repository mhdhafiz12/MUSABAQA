begin;

alter table public.programs drop constraint if exists programs_session_check;

-- Move only unchanged starter records into the new blocks. Programs already
-- edited by an administrator are left untouched.
update public.programs as program
set session = starter.session,
    start_time = starter.start_time::time,
    duration_minutes = starter.duration_minutes,
    category = starter.category
from (values
  ('Opening Ceremony', '09:00', 'subahi', '05:30', 20, 'Welcome session'),
  ('Qur''an Recitation', '09:20', 'subahi', '05:50', 25, 'Junior category'),
  ('Malayalam Speech', '09:45', 'morning', '09:00', 25, 'Senior category'),
  ('Solo Song', '10:10', 'morning', '09:25', 30, 'Junior category'),
  ('English Speech', '10:40', 'morning', '09:55', 20, 'Senior category'),
  ('Group Song', '11:00', 'morning', '10:15', 30, 'Junior category'),
  ('Arabic Speech', '11:30', 'morning', '10:45', 30, 'Senior category'),
  ('Nasheed', '12:00', 'morning', '11:15', 30, 'Open category'),
  ('Lunch & Prayer Break', '12:30', 'morning', '11:45', 60, 'Morning session close'),
  ('Storytelling', '13:30', 'afternoon', '14:30', 25, 'Junior category'),
  ('Poem Recitation', '13:55', 'afternoon', '14:55', 30, 'Senior category'),
  ('Debate', '14:25', 'afternoon', '15:25', 40, 'Team event'),
  ('Quiz Final', '15:05', 'afternoon', '16:05', 25, 'Senior category'),
  ('Calligraphy', '15:40', 'evening', '19:30', 30, 'Open category'),
  ('Mime', '16:10', 'evening', '20:00', 20, 'Team event'),
  ('Oppana', '16:30', 'evening', '20:20', 25, 'Team event'),
  ('Duff Muttu', '17:00', 'night', '21:30', 30, 'Team event'),
  ('Prize Giving', '17:30', 'night', '22:00', 40, 'Awards ceremony'),
  ('Closing Ceremony', '18:10', 'night', '22:40', 20, 'Vote of thanks')
) as starter(title, old_start_time, session, start_time, duration_minutes, category)
where program.title = starter.title
  and program.start_time = starter.old_start_time::time;

update public.participants as participant
set reporting_time = '09:40'::time
from public.programs as program
where participant.program_id = program.id
  and program.title = 'English Speech'
  and participant.reporting_time between '10:40'::time and '10:55'::time;

alter table public.programs
  add constraint programs_session_check
  check (session in ('subahi','morning','afternoon','evening','night'));

commit;
