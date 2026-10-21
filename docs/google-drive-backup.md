# Google Drive backups

The Pharmacy Store > Backup File Name page stores Excel backups in a private Google Drive folder. The first successful run creates a timestamped folder; subsequent runs reuse it. Product Management is uploaded only once per pharmacy account after a successful upload. Backup history records each run and its uploaded filenames.

## Google Cloud setup

1. Create or select a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen for the intended users and add the `https://www.googleapis.com/auth/drive.file` scope.
3. Create an OAuth client ID with application type **Web application**.
4. Add `https://YOUR_APP_HOST/api/backup/google/callback` as an authorized redirect URI. Use the production hostname in production and the localhost callback when testing locally.
5. Keep the OAuth client secret private. Do not put it in a `NEXT_PUBLIC_*` variable or commit it.

Google OAuth apps left in Testing mode can issue refresh tokens that expire after seven days. Publish/configure the consent screen appropriately before relying on unattended backups.

## Application secrets

Configure these on the Next.js server and deploy the app:

- `BACKUP_GOOGLE_CLIENT_ID`
- `BACKUP_GOOGLE_CLIENT_SECRET`
- `BACKUP_TOKEN_ENCRYPTION_KEY` — generate a new 32-byte key, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it only in the Next.js server environment. Never rotate it without first reconnecting affected Drive accounts.
- `BACKUP_APP_URL` — the canonical app origin, such as `https://app.example.com`.
- `BACKUP_CRON_SECRET` — a separate random secret used only by Supabase Cron to authorize scheduled requests.

The refresh token is encrypted before it is written to a separate private secrets table. The Google Drive scope is limited to files created or opened by this app.

## Supabase setup

1. Apply database migrations, including `20261021180000_pharmacy_drive_backups.sql` and `20261021181500_pharmacy_drive_backup_mobile_oauth.sql`.
2. Enable `pg_cron`, `pg_net`, and Vault for the Supabase project. In the Supabase SQL editor, store the Next.js endpoint URL and the same cron secret in Vault (replace placeholders; do not commit actual values):

   ```sql
   select vault.create_secret(
     'https://YOUR_APP_HOST/api/backup/run',
     'drive_backup_function_url'
   );

   select vault.create_secret('YOUR_BACKUP_CRON_SECRET', 'drive_backup_cron_secret');
   ```

3. Schedule a poll every 15 minutes. Supabase only runs backups whose configured next-run time is due:

   ```sql
   select cron.schedule(
     'pharmacy-drive-backup-runner',
     '*/15 * * * *',
     $$
       select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'drive_backup_function_url'),
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'x-backup-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'drive_backup_cron_secret')
         ),
         body := '{}'::jsonb
       );
     $$
   );
   ```

After deployment, a pharmacy owner connects Google Drive once from Settings. Auto Backup then runs on the server at the selected interval, whether or not the dashboard is open. The weekly/monthly choices are 7/30-day intervals; Custom accepts 1–3650 days.

## Mobile app

Set `EXPO_PUBLIC_WEB_APP_URL` in `Mobile/.env.local` to the reachable web-app origin used by the mobile devices. For a physical device, do not use `localhost`; use a deployed HTTPS origin or a host address reachable on the same network. Restart Expo after changing the value. The mobile BackUp Setting page uses the same authenticated backup APIs, and Google OAuth returns to the app's `mobile://dashboard/menu/backup-file` deep link after authorization.
