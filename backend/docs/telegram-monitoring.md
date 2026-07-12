# Telegram monitoring (new users + incidents)

Operator alerts to a Telegram group when a **new user** signs up or an
**incident** (error) is logged. Event-driven at the **data layer** — fires on
any INSERT (app, cron, or manual SQL), not tied to a specific code path.

## Flow

```
INSERT into public.profiles  (new user)      ┐
INSERT into public.incidents (error)         ┘
        │  Postgres AFTER INSERT trigger (pg_net, async)
        ▼
POST https://<backend>/webhooks/supabase      (header X-Webhook-Secret)
        │  FastAPI verifies the secret, formats the message
        ▼
Telegram Bot API  →  group "Copo log"
```

## Components

**Backend (code, in repo):**
- `app/services/telegram.py` — `notify(text)`: fire-and-forget send, no-op unless
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are set, never raises, 20 msg/min cap.
- `app/routers/webhooks.py` — `POST /webhooks/supabase`: gated by
  `X-Webhook-Secret == SUPABASE_WEBHOOK_SECRET` (unset → 503, mismatch → 401).
  `profiles`→"🎉 User mới" + running total (`count(*) from profiles`, best-effort),
  `incidents`→"🔴/🟡 Incident". Ignores UPDATE/DELETE.

**Database (Supabase, set up via SQL — NOT in the dashboard Webhooks UI):**
- Extension `pg_net` (async HTTP from Postgres).
- Function `public.notify_telegram_webhook()` — reads the secret from **Vault**
  (`vault.decrypted_secrets`, name `telegram_webhook_secret`), POSTs to the
  backend. Wrapped in `exception when others then null` so a monitoring failure
  can never roll back the INSERT.
- Triggers: `tg_notify_new_user` on `profiles`, `tg_notify_incident` on
  `incidents` (both AFTER INSERT FOR EACH ROW).

## Config (values live in 2 places, must match)

| What | Where | Notes |
|------|-------|-------|
| `TELEGRAM_BOT_TOKEN` | backend env (Railway) | from @BotFather |
| `TELEGRAM_CHAT_ID` | backend env (Railway) | group "Copo log" (negative id) |
| `SUPABASE_WEBHOOK_SECRET` | backend env (Railway) | backend's copy of the shared secret |
| `telegram_webhook_secret` | **Supabase Vault** | DB trigger's copy — MUST equal the env one |

The backend URL is a literal in the trigger function (public, not a secret).
The shared secret is **never** hardcoded in code or SQL — env on one side, Vault
on the other.

## Recreate the DB side (disaster recovery)

Run in the Supabase SQL Editor (secret must already be in Vault — see Rotate):

```sql
create extension if not exists pg_net;

create or replace function public.notify_telegram_webhook()
returns trigger language plpgsql security definer
set search_path = public, vault, net
as $fn$
declare v_secret text;
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'telegram_webhook_secret' limit 1;
    perform net.http_post(
      url     := 'https://<backend>/webhooks/supabase',
      headers := jsonb_build_object('Content-Type','application/json','X-Webhook-Secret', v_secret),
      body    := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'record', to_jsonb(NEW))
    );
  exception when others then null;  -- never block the write
  end;
  return NEW;
end;
$fn$;

drop trigger if exists tg_notify_new_user on public.profiles;
create trigger tg_notify_new_user  after insert on public.profiles
  for each row execute function public.notify_telegram_webhook();

drop trigger if exists tg_notify_incident on public.incidents;
create trigger tg_notify_incident  after insert on public.incidents
  for each row execute function public.notify_telegram_webhook();
```

## Rotate the shared secret

Change BOTH, to the same new value:

1. **Vault** — Dashboard → Project Settings → Vault (or SQL):
   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name='telegram_webhook_secret'),
     '<new-secret>');
   ```
2. **Railway** — set `SUPABASE_WEBHOOK_SECRET=<new-secret>` → redeploy.

## Test

Insert a throwaway incident and check the group:

```sql
insert into incidents (incident_type, source, module, message)
values ('system_error','backend','webhook.test','test — ignore');
-- check net._http_response for status_code (200 = ok, 401 = secret mismatch,
-- 503 = backend secret unset, 404 = endpoint not deployed)
delete from incidents where module='webhook.test';
```

A `🔴` message should land in the group. Deleting the row does not unsend the
Telegram message.

## Gotchas

- `/webhooks/supabase` is behind the 30 req/min/IP rate limiter — a large
  incident storm can 429 (Supabase retries). Exempt `/webhooks` if that bites.
- Both secret copies must match or every call 401s silently (no alert).
- If `TELEGRAM_CHAT_ID`/`TOKEN` are unset on Railway, the endpoint still returns
  200 but sends nothing (silent no-op).
