-- DB から通知を送るときの合言葉。service_role の鍵を SQL に置かずに済ませるため。
-- push_config はポリシーが無いので、クライアントからは読めない。
alter table public.push_config add column if not exists send_secret text not null default '';
update public.push_config
   set send_secret = encode(gen_random_bytes(24), 'hex')
 where id = 1 and coalesce(send_secret, '') = '';