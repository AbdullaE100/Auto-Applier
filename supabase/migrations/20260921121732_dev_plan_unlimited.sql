-- Hidden Developer plan: effectively unlimited applications and AI answers
insert into public.plans (id, name, monthly_applications, daily_ai_answers, price_cents, is_public, sort_order)
values ('dev', 'Developer', 1000000, 100000, 0, false, 99)
on conflict (id) do update set monthly_applications = excluded.monthly_applications, daily_ai_answers = excluded.daily_ai_answers;

-- Subscriptions are guarded (server-only): act as the server for this update
select set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.subscriptions s set plan_id = 'dev'
from auth.users u
where u.id = s.user_id and lower(u.email) = 'abdullaehsan2002@gmail.com';
