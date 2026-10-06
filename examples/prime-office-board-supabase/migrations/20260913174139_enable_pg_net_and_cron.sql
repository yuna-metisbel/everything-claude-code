-- 通知を送るために、DB から Edge Function を呼べるようにする（pg_net）。
-- 朝のまとめは時刻で動かす必要があるので pg_cron も入れる。
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;