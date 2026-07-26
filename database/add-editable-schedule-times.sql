begin;

alter table public.site_settings
  add column if not exists schedule_blocks jsonb not null
  default '[{"key":"subahi","label":"Subahi","start_time":"05:00","end_time":"07:00"},{"key":"morning","label":"Morning","start_time":"09:00","end_time":"12:45"},{"key":"afternoon","label":"Afternoon","start_time":"14:30","end_time":"16:30"},{"key":"evening","label":"Evening","start_time":"19:30","end_time":"20:45"},{"key":"night","label":"Night","start_time":"21:30","end_time":"23:00"}]'::jsonb;

commit;
