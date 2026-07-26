begin;
truncate public.results, public.participants, public.programs, public.teams restart identity cascade;

insert into public.teams (slug,name,score,color) values
('green','Green Group',98,'#078521'),('white','White Group',92,'#f4f7f3'),('blue','Blue Group',86,'#1725a9'),('yellow','Yellow Group',77,'#bced16');

insert into public.programs (title,category,session,start_time,duration_minutes,status,venue) values
('Opening Ceremony','Welcome session','subahi','05:30',20,'completed','Main Auditorium'),
('Qur''an Recitation','Junior category','subahi','05:50',25,'completed','Main Auditorium'),
('Malayalam Speech','Senior category','morning','09:00',25,'completed','Main Auditorium'),
('Solo Song','Junior category','morning','09:25',30,'completed','Main Auditorium'),
('English Speech','Senior category','morning','09:55',20,'live','Main Auditorium'),
('Group Song','Junior category','morning','10:15',30,'upcoming','Main Auditorium'),
('Arabic Speech','Senior category','morning','10:45',30,'upcoming','Main Auditorium'),
('Nasheed','Open category','morning','11:15',30,'upcoming','Main Auditorium'),
('Lunch & Prayer Break','Morning session close','morning','11:45',60,'upcoming','Campus'),
('Storytelling','Junior category','afternoon','14:30',25,'upcoming','Main Auditorium'),
('Poem Recitation','Senior category','afternoon','14:55',30,'upcoming','Main Auditorium'),
('Debate','Team event','afternoon','15:25',40,'upcoming','Main Auditorium'),
('Quiz Final','Senior category','afternoon','16:05',25,'upcoming','Main Auditorium'),
('Calligraphy','Open category','evening','19:30',30,'upcoming','Creative Hall'),
('Mime','Team event','evening','20:00',20,'upcoming','Main Auditorium'),
('Oppana','Team event','evening','20:20',25,'upcoming','Main Auditorium'),
('Duff Muttu','Team event','night','21:30',30,'upcoming','Main Auditorium'),
('Prize Giving','Awards ceremony','night','22:00',40,'upcoming','Main Auditorium'),
('Closing Ceremony','Vote of thanks','night','22:40',20,'upcoming','Main Auditorium');

insert into public.participants (code,name,team_id,program_id,category,reporting_time) values
('KZ-001','Afnan Muhammed',1,5,'Senior','09:40'),('KZ-002','Sinan Ahmed',2,5,'Senior','09:40'),
('KZ-003','Rishan Ali',3,5,'Senior','09:40'),('KZ-004','Nihal Basheer',4,5,'Senior','09:40');

insert into public.results (program_id,participant_id,score,position,is_published,published_at) values
(5,1,94,1,true,now()),(5,2,91,2,true,now()),(5,3,89,3,true,now()),(5,4,87,4,true,now());
commit;
