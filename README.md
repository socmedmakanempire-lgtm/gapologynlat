# Gapology on Cloudflare Pages

This package adds shared online saving to the existing SOP interface. Dropbox continues to serve images and videos. D1 stores the catalog, structured steps, staff visibility, the reusable media library, and edit history.

The public site is `public/index.html`. It requires the included Pages Functions and a D1 database. Opening that HTML by itself, or hosting only `public/` on GitHub Pages, does not enable saving.

## What you need to do

1. **Export existing edits first.** In your current site, use Admin → Data Backup & Reset → Export Catalog. Keep that backup. Locally saved edits are not included in the original HTML.
2. **Create a Cloudflare account** at https://dash.cloudflare.com/. The package targets the Workers/Pages and D1 free allowances. No paid service is required by this code. Actual usage must stay within the allowances.
3. **Install a current Node.js LTS release** from https://nodejs.org/ (Node 22.13 or newer for the SQLite tests). Extract the package and open a Terminal in its `gapology-cloudflare` folder.
4. **Install the deployment tool and sign in:**

   ```sh
   npm install
   npx wrangler login
   ```

5. **Create the shared database:**

   ```sh
   npx wrangler d1 create gapology
   ```

   Copy the returned `database_id` into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Keep the binding name exactly `DB`. Then create its tables:

   ```sh
   npm run migrate:remote
   ```

6. **Create the Pages project:**

   ```sh
   npx wrangler pages project create gapology --production-branch main
   ```

   If you use a different Pages project name, replace `gapology` after `--project-name` in the following commands and in `package.json`'s deploy script. The D1 database name does not need to change.

7. **Set private server secrets.** These commands prompt you to enter values. Do not place real passwords or secrets in the HTML, repository, or chat:

   ```sh
   npx wrangler pages secret put ADMIN_PASSWORD --project-name gapology
   npx wrangler pages secret put SESSION_SECRET --project-name gapology
   npx wrangler pages secret put ADMIN_NAME --project-name gapology
   ```

   - `ADMIN_PASSWORD`: your chosen manager password, at least 12 characters. This is the password used by the Cloudflare version. The previous passwords and rotating password lookup are not bundled into the public page.
   - `SESSION_SECRET`: a random secret of at least 32 characters. You can generate one with `openssl rand -hex 32`, then paste it at the prompt. Changing this secret invalidates existing manager sessions.
   - `ADMIN_NAME`: the manager label displayed in edit history. This is one shared manager account, so the history cannot distinguish two people using the same password. Separate individual accounts would require an additional authentication integration.

8. **Deploy from the package root:**

   ```sh
   npm run deploy
   ```

   Wrangler deploys `public/` and compiles the root `functions/` folder, including the private server module. Keep the complete folder structure. Open the Pages URL printed after deployment.

   If the API reports a missing database, open your Pages project → Settings → Bindings. Confirm that the D1 binding is named `DB` and points at the database you created. Redeploy after changing bindings or secrets.

9. **Load your content.** Sign in as Manager using the secret you configured. Open Admin → Data Backup & Reset and paste your exported backup JSON, then click Restore pasted backup. If you have no backup, open Admin and click Load starter catalog into shared storage. The package includes 95 starter items. All starter items begin hidden from staff.
10. **Wait for “Saved online”.** Enable the green eye on items that staff may view. Open the same Pages address in a separate browser or phone, choose Staff, and confirm those items appear. Staff tabs check for changes every 30 seconds while visible, and on focus. Content edits do not require another deployment.

## Files and deployment boundaries

| Path | Purpose |
| --- | --- |
| `public/` | Public HTML, browser saving adapter, and static security/routing settings |
| `functions/api/[[path]].js` | Pages Functions API entry point |
| `server/backend.mjs` | Authentication, filtered staff reads, validation, revision checking, and audit writes |
| `server/seed.mjs` | Starter content and legacy recipes, returned only after manager authentication |
| `migrations/0001_shared_state.sql` | D1 catalog, history, and login-rate-limit tables |
| `tests/` | SQLite-backed API and browser-adapter tests |
| `wrangler.jsonc` | Pages output directory and D1 binding |

The starter content is present in the source package. Keep the source repository private, or deploy locally with Wrangler. Do not upload `server/`, tests, backups, or the whole ZIP as publicly served website files. Only `public/` is the static publishing directory.

Use Wrangler for this package. The dashboard's ordinary drag-and-drop upload does not compile a `functions/` folder. Git integration is another option if the source repository is private and the publishing directory is `public`.

## Saving, caching, and conflicts

- D1 is the shared source of truth. Browser refreshes, different browsers, and staff devices receive shared data through the API.
- Save actions are briefly combined, then sent online. The fixed status bar distinguishes pending, failed, and confirmed saves. An item's editor can close while its online save is still pending; wait for the status bar before leaving.
- A pending manager draft is kept in `sessionStorage` in the same browser tab. Refreshing that tab can recover it after reauthentication. Closing the tab or clearing its storage can remove an unsynced draft. Use Download unsaved draft to preserve it as a file. This cache is a recovery aid, not shared storage or a permanent backup.
- Staff receive only approved items from the server. Hidden items, unused library entries, and historical versions are not sent to staff. A video disabled for staff is removed from the staff response, including step videos.
- Manager background refresh pauses while the admin panel, item editor, or page edit mode is open, so unsaved form fields are not replaced by incoming data.
- Two editors cannot silently overwrite each other. A stale save is rejected. Download the unsynced draft, load the latest shared version, then reapply the desired changes.
- Successful saves and audit records are written in one D1 transaction. Retries after a lost response use an operation ID to avoid duplicate revisions.
- Edit history records the configured manager label, timestamp, affected records/fields, and before/after snapshots. It records saved revisions, which can combine closely spaced actions, rather than every click or video view. History is append-only through the application; the Cloudflare account owner can still administer the database directly.
- A history revision can be downloaded and pasted into backup restore. This creates a new revision rather than removing history.
- Dropbox share links retain Dropbox's own viewing permissions. The application cannot revoke a previously obtained Dropbox link or content someone has already viewed.

## Backups and reset

Export Catalog downloads the current catalog and media library. Export only after pending changes have been confirmed saved. A downloaded unsynced draft can also be restored through the pasted-JSON importer.

Reset to defaults replaces shared content with the starter catalog and clears unused library entries. It is a shared operation that affects every device. Existing history remains available. Re-running the migration is safe and does not overwrite existing shared data.

Use D1's own backup/export tools as an additional backup of the history database. The JSON catalog backup contains the current content, not the complete edit-history table.

## Local development and verification

```sh
cp .dev.vars.example .dev.vars
```

Replace the placeholder values in `.dev.vars` with local test secrets. It is ignored by Git and never belongs in `public/`.

```sh
npm run migrate:local
npm run dev
npm test
```

The tests use Node's built-in SQLite with a D1-compatible adapter and real Request/Response objects. They check authentication, CSRF protection, login rate limits, staff data filtering, snapshot migration, atomic history, simultaneous edit conflicts, idempotent retries, and the existing item/step/media UI against the API. A live Cloudflare deployment still needs the real D1 binding and secrets, followed by a browser playback check with your Dropbox links.

## Free-plan usage

Cloudflare's documented free allowances include 100,000 combined Workers/Functions requests per day. D1 includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage. These are separate limits, not a guarantee of unlimited usage. Visible staff tabs poll every 30 seconds, so usage scales with active tabs. Change the interval in `public/cloud.js` if needed. Hidden tabs do not poll.

Every revision retains before/after snapshots for history. Storage use grows as edits accumulate. Monitor Workers/Pages and D1 usage in Cloudflare.

References:
- https://developers.cloudflare.com/pages/functions/bindings/#d1-databases
- https://developers.cloudflare.com/pages/get-started/direct-upload/#functions
- https://developers.cloudflare.com/pages/functions/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
