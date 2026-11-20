-- あとから足した表が realtime の配信対象に入っておらず、
-- 他の人の変更が画面に出てこなかった。読んでよい人にだけ届くことは RLS が決める。
--
-- staff だけは入れない。pin 列はクライアントに渡してはいけないもので、
-- realtime が列単位の権限まで見てくれるか確かめられないため、
-- 確かめられないものを配信対象にはしない。名簿の変更は頻繁ではないので、
-- 画面に戻ったときの読み直しで十分に追いつく。
alter publication supabase_realtime add table public.sites;
alter publication supabase_realtime add table public.punches;
alter publication supabase_realtime add table public.key_events;
alter publication supabase_realtime add table public.key_duty;
alter publication supabase_realtime add table public.staff_shifts;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.board_settings;