-- Settings v2: configurable automation (see extension/shared/settings.js)
alter table public.profiles
  alter column settings set default '{"mode":"review","dailyLimit":20,"maxPerRun":10,"pace":"normal","useAI":true,"whenUnknown":"ask","askTimeoutSec":0,"rememberAnswers":true}'::jsonb;
