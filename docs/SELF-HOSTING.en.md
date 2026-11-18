# Install your own copy of the galleries

This guide is for a photographer who wants **their own copy** of the galleries app, running on **their own** Google, Cloudflare and GitHub accounts. Your photos stay in your Google Drive, the app runs in your Cloudflare account, and nobody else has access.

- You do not need to know how to program. Everything happens in the browser.
- Estimated time: **1 to 2 hours** the first time.
- Spanish version: [SELF-HOSTING.md](SELF-HOSTING.md). Both say the same thing.
- If an AI assistant with browser or terminal access is helping you, give it the **[Agent mode](#agent-mode)** section at the end.

> **Permission to use.** The code is proprietary, "all rights reserved" (see the `LICENSE` file in the repository). You may not copy or use it without the **written permission of the code's owner**. Ask for that permission before you start. This is not legal advice.

> **Code version.** This guide needs a version of the code prepared for other people to install (no owner values inside the automated tests). If in step 8 the run fails in **Checks** with a test called `has both custom-domain routes and the vars`, your copy predates that preparation: tell the code's owner and wait for the new version.
>
> In plain words: this guide only works once the repository's own automated tests no longer check the original owner's domain. That is a code fix the owner is deciding on. **AI agents:** before step 8, check whether the fork contains that fix (ask the owner, or look at the result of the **CI** run); if it does not, stop and tell the person.

---

## Contents

1. [What you need](#0-what-you-need)
2. [What it costs](#what-it-costs)
3. [Your values](#your-values)
4. Steps: [1 Copy](#step-1-your-copy-of-the-code) · [2 Domain](#step-2-your-domain-on-cloudflare) · [3 Configuration](#step-3-put-your-values-in-the-configuration) · [4 Google](#step-4-google-cloud-read-only-access-to-your-drive) · [5 Admin login](#step-5-cloudflare-access-the-admin-login) · [6 Token](#step-6-cloudflare-token-and-turning-on-r2) · [7 Secrets](#step-7-add-the-secrets-to-github) · [8 Setup](#step-8-run-setup) · [9 Security](#step-9-domain-security-settings) · [10 First use](#step-10-first-use) · [11 Capture One](#step-11-capture-one-and-drive-for-desktop)
5. [Maintenance](#maintenance) · [Common problems](#common-problems) · [Agent mode](#agent-mode)

---

## 0. What you need

Tick each item before you start:

- [ ] **Written permission** from the code's owner (see above).
- [ ] A **Google account** with Google Drive (the one where your photos will live).
- [ ] A **Cloudflare account** (free): <https://dash.cloudflare.com/sign-up>.
- [ ] A **GitHub account** (free): <https://github.com/signup>.
- [ ] Your **own domain** (for example `yourstudio.com`) **managed by Cloudflare**. If it is managed somewhere else, you move it to Cloudflare in step 2 (it is still yours; only who answers DNS changes).
- [ ] A **card** (or PayPal) to add as a payment method in Cloudflare. R2 storage asks for one to be turned on, even if you only use the free part (see "What it costs").
- [ ] **Capture One** and **Google Drive for desktop** on your computer (only for step 11).

**What about no domain, using the free `workers.dev` address?** It **does not work** today. The app is set up on purpose not to answer on `workers.dev`: the admin panel relies on the Cloudflare Access login, and on `workers.dev` Cloudflare only offers to protect the **whole** site (that would also block your clients, who must see their galleries without logging in). You need a domain. A `.com` domain costs about USD 10 to 15 per year; a `.com.ar` is registered at NIC Argentina.

## What it costs

| What | Cost | Notes |
|---|---|---|
| Cloudflare Workers (the app) | **Free** | Free plan: 100,000 requests per day. If syncing a large library hits the free plan limits, **Workers Paid costs USD 5 per month** (see Common problems). |
| Cloudflare D1 (the database) | **Free** | 5 GB on the free plan; the app stores little (galleries, visits, favorites). |
| Cloudflare R2 (image cache) | **Free** up to 10 GB | Then USD 0.015 per GB per month. Needs a payment method to be turned on. |
| Cloudflare Access (admin login) | **Free** | Up to 50 users. You are 1. |
| Google Cloud (permission to read Drive) | **Free** | No billing account needed. |
| Google Drive | What you already pay | Photos use your Drive space (15 GB free; more with Google One). |
| GitHub | **Free** | Public repository: Actions are free. Private: 2,000 free minutes per month; each deploy uses a few minutes. |
| Domain | **About USD 10–15 per year** | Depends on the ending and the registrar. |

Prices are indicative and change: check them on Cloudflare's pricing page before you start.

## Your values

Choose these values **once** and write them down. In the rest of the guide they appear between `< >`: whenever you see, for example, `<GALLERY_HOST>`, replace it with your value.

| Value | What it is | Example |
|---|---|---|
| `<STUDIO_NAME>` | Your studio name, as your clients see it. No double quotes. | `Light Studio` |
| `<ROOT_DOMAIN>` | Your domain (no `www`, no `https://`). | `lightstudio.com` |
| `<GALLERY_HOST>` | The galleries address: a subdomain of your domain that you do **not** use for anything else. | `photos.lightstudio.com` |
| `<ADMIN_EMAIL>` | Your email to log in to the panel. Use **the same email as your Cloudflare account**. | `hello@lightstudio.com` |
| `<DRIVE_FOLDER>` | Name of the Drive folder that holds all galleries. | `galleries` |
| `<ACCESS_TEAM>` | "Team" name in Cloudflare Zero Trust (letters and hyphens). | `lightstudio` |
| `<GOOGLE_PROJECT>` | Name of the Google Cloud project. | `lightstudio-galleries` |
| `<GITHUB_USER>` | Your GitHub username. | `lightstudio` |
| `<CONTACT_EMAIL>` | Optional. Public contact email shown on your `/privacy` page. | `hello@lightstudio.com` |

**Secrets** (secret keys). You do not choose them: you copy them from Google and Cloudflare during the guide and paste them **directly** into GitHub. **Never** paste them into a chat, an email, a document or the code.

| GitHub secret | Where it comes from | Step |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud | 4 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud | 4 |
| `ADMIN_EMAIL` | Your `<ADMIN_EMAIL>` | 5 |
| `ACCESS_TEAM_DOMAIN` | `<ACCESS_TEAM>.cloudflareaccess.com` | 5 |
| `ACCESS_AUD` | Cloudflare Access | 5 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare | 6 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | 6 |

There are three more secrets (`SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY`) that the app generates by itself in step 8. You do not need to do anything with them.

---

## Step 1. Your copy of the code

The code's owner gives you access to the repository and tells you how to copy it. Usually it is a **fork** (a copy in your GitHub account that can later be updated with one button).

1. Log in to GitHub and open the repository address the owner gave you.
2. Top right, click **Fork** → **Create fork**. Leave **Copy the main branch only** ticked.
3. In your copy, open the **Actions** tab. GitHub shows "Workflows aren't being run on this forked repository": click **I understand my workflows, go ahead and enable them**.

**What you should see:** the address is `https://github.com/<GITHUB_USER>/<repo-name>` and the Actions tab lists **CI**, **Deploy** and **Setup**.

**Important:**
- If the owner removes your access to the original repository and that repository is private, GitHub **deletes your fork**. Your galleries keep working on Cloudflare, but you lose the copy of the code.
- Only you should have write access to your copy: anyone who can change the workflows can read the secrets you add in step 7.

## Step 2. Your domain on Cloudflare

If `<ROOT_DOMAIN>` already shows as **Active** in your Cloudflare dashboard, skip to step 3.

1. Cloudflare → **Add a domain** (or **Onboard a domain**) → type `<ROOT_DOMAIN>` → **Free** plan.
2. Cloudflare copies the DNS records it finds. Check that your current website and email records are there.
3. Cloudflare shows **two nameservers** (for example `xxx.ns.cloudflare.com`). Go to the site where you bought the domain and replace its nameservers with those two.
4. Wait. It can take from minutes to 24 hours.

**How to know it worked:** in Cloudflare the domain shows as **Active** and you get a confirmation email.

**Do not create** any DNS record for `<GALLERY_HOST>`: the app creates it in step 8. If one with that name already exists, delete it.

## Step 3. Put your values in the configuration

You edit a single file, `wrangler.jsonc`, in the browser.

1. In your repository, open the file `wrangler.jsonc` and click the **pencil** (Edit this file).
2. Find the block that starts with `"routes": [` and ends with `],` (about 5 lines, including a comment line starting with `//`). **Replace that whole block** (comment lines included) with these five lines, exactly as shown (same indentation, one item per line):

   ```jsonc
     "routes": [
       {
         "pattern": "<GALLERY_HOST>",
         "custom_domain": true,
       },
     ],
   ```

3. Further down, inside `"vars"`, change only what is between quotes on the right of these three lines, so they read:

   ```jsonc
       "STUDIO_NAME": "<STUDIO_NAME>",
       "PUBLIC_ORIGIN": "https://<GALLERY_HOST>",
       "LEGACY_HOSTS": "",
   ```

   Optional: if you want a public contact email on your `/privacy` page, add one more line in the same place, with a comma at the end: `"PUBLIC_CONTACT_EMAIL": "<CONTACT_EMAIL>",`. Without it, `/privacy` shows a generic text ("contact the studio through the usual channels") instead of an email.

4. **Do not touch** anything else (not even `database_id`: it is filled in by step 8). Keep the quotes and the comma at the end of each line.
5. Click **Commit changes…** → message "My values" → **Commit changes**.

**What you will see next:** in the **Actions** tab a **Deploy** run appears. It may fail (red cross) until you have run Setup in step 8. That is expected: it can fail in **Checks** (see Common problems), or because of a database (D1) error, since the app is not fully installed yet. Do not try to fix it now; carry on and judge the result after step 8.

**Your name and your logo (optional, you can do it later):** `STUDIO_NAME` is the name shown on the public pages (as the logo's text description, in the footer and on the privacy page), in link previews, in the name of the app when a client adds a gallery to the home screen, and in the panel. You can also change it later in the panel (**Ajustes**), which takes priority over the value in `wrangler.jsonc`. **It does not change any image or file:** the logo, the icons and the generic app file `public/manifest.webmanifest` (it still carries the original name until you edit its `name` and `short_name`) stay as they came. Also, a hint text in the empty gallery list of the panel mentions the original folder name; ignore it. The logos are `public/brand/logo-black.svg` (on light backgrounds) and `public/brand/logo-white.svg` (on dark backgrounds). In GitHub, open the `public/brand` folder → **Add file → Upload files** → upload your two SVG files **with those exact names** → **Commit changes**. The browser tab icon is `public/favicon.svg`. The "add to home screen" icons (`public/icons/*.png`, `public/apple-touch-icon.png`, `public/favicon.ico`) must be regenerated by someone with a prepared computer (for example, agent mode); until then the originals stay.

## Step 4. Google Cloud (read-only access to your Drive)

The app needs permission to **read** your Drive. It never writes or deletes anything.

1. Go to <https://console.cloud.google.com> with your Google account → project picker (top) → **New project** → name `<GOOGLE_PROJECT>` → **Create**. Make sure it is selected.
2. Menu ☰ → **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. Menu ☰ → **Google Auth Platform** (if asked, click **Get started**) and fill in:
   - **Branding:** app name `<STUDIO_NAME> Galleries`, your email as support and contact. **Application home page:** `https://<GALLERY_HOST>`. **Privacy policy link:** `https://<GALLERY_HOST>/privacy`. Under **Authorized domains** add `<ROOT_DOMAIN>`. Save.
   - **Audience:** type **External**. Click **Publish app** → confirm **In production**.
   - **Data Access:** **Add or remove scopes** → under "Manually add scopes" paste `https://www.googleapis.com/auth/drive.readonly` → **Add to table** → **Update** → **Save**.
   - **Clients:** **Create client** → type **Web application** → name `galleries`. Under **Authorized redirect URIs** → **Add URI** → exactly:
     `https://<GALLERY_HOST>/admin/google/callback`
     → **Create**.
4. Google shows the **Client ID** and **Client secret**. **Add them to GitHub now**, following the procedure in step 7 (open GitHub in another tab): create `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then close the Google tab. (If you closed it too early, the Client ID is under **Clients**; if you lost the secret, create a new one on the same client.)

**How to know it worked:** **Audience** says **In production**, and under **Clients** your client has the redirect URI.

**It is normal** for Google to say the app "is not verified": only you use it, with your photos. See step 10.

## Step 5. Cloudflare Access (the admin login)

This protects the admin panel (`/admin`): only you can get in. Your clients' galleries stay public (with a PIN if you choose).

1. Cloudflare → **Zero Trust**. The first time, it asks for a **team name**: enter `<ACCESS_TEAM>`, and choose the **Free** plan. Your "team domain" is `<ACCESS_TEAM>.cloudflareaccess.com`.
2. **Access controls → Applications → Create new application** (or **Add an application**) → **Self-hosted** (it may say "Self-hosted and private").
3. Name: `<STUDIO_NAME> Admin`.
4. **Add public hostname** three times, all in this same application:
   - subdomain = the part of `<GALLERY_HOST>` before your domain (in the example, `photos`), domain `<ROOT_DOMAIN>`, path `admin`
   - same, path `api/admin`
   - same, path `admin.data`
5. **Access policies** → create a new one: name `Only me`, action **Allow**, rule **Include → Emails** = `<ADMIN_EMAIL>`.
6. **Login methods:** new accounts come with login through your Cloudflare account; nothing to set up. With that default login, the email allowed in the policy (and the `ADMIN_EMAIL` secret) **must be the same as your Cloudflare account email**, or you will not get in. (Optional: **Integrations → Identity providers → Add → One-time PIN** to log in with an emailed code.)
7. **Session Duration:** 24 hours → **Create** (or **Save**).
8. In the applications list, **Configure** on `<STUDIO_NAME> Admin` → **Basic information** (or **Overview**) → copy the **Application Audience (AUD) Tag**. It is the value of the `ACCESS_AUD` secret.
9. **Add to GitHub now**, following the procedure in step 7: create `ACCESS_AUD` (the AUD tag), `ADMIN_EMAIL` (your `<ADMIN_EMAIL>`) and `ACCESS_TEAM_DOMAIN` (`<ACCESS_TEAM>.cloudflareaccess.com`, no `https://`).

**How to know it worked:** the application is listed with three hostnames and the `Only me` policy.

## Step 6. Cloudflare token and turning on R2

**6a. Turn on R2:**

1. Cloudflare → **Storage & databases → R2** (or **R2 Object Storage**) → **Purchase R2 / Add R2 to plan**. If it asks for a payment method, add it. The free plan does not charge while you stay under the limits.

**How to know it worked:** the R2 page shows the (empty) list of buckets without asking you to turn anything on.

**6b. API token** (a key that lets GitHub install the app in your Cloudflare):

1. Cloudflare → profile icon → **My Profile → API Tokens → Create Token → Create Custom Token** (**Get started**).
2. Name: `galleries-github`. Permissions (click **+ Add more** for each row):
   - **Account → Workers Scripts → Edit**
   - **Account → D1 → Edit**
   - **Account → Workers R2 Storage → Edit**
   - **Account → Account Settings → Read**
   - **Zone → Workers Routes → Edit**
   - **Zone → DNS → Edit**
   - **Zone → Zone → Read**
3. **Account Resources:** Include → your account. **Zone Resources:** Include → **Specific zone** → `<ROOT_DOMAIN>`.
4. **Continue to summary → Create Token.** Cloudflare shows the token **only once**: add it to GitHub right now (next item).
5. **Account ID:** Cloudflare → **Workers & Pages** → **Account details** (or the right sidebar) → copy the Account ID.
6. **Add to GitHub now**, following the procedure in step 7: create `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then close the Cloudflare tab that showed the token.

## Step 7. Add the secrets to GitHub

1. In your repository: **Settings → Secrets and variables → Actions → New repository secret**.
2. Create the secrets from the [Your values](#your-values) table, one by one, **at the end of steps 4, 5 and 6** as those steps tell you (so no secret value stays open on your screen for long). If you did, here you only check the list. **Name** is the exact name (in capitals); **Secret** is the value copied **directly** from the Google or Cloudflare tab. For `ACCESS_TEAM_DOMAIN` enter `<ACCESS_TEAM>.cloudflareaccess.com` (no `https://`).
3. When you are done, close the Google and Cloudflare tabs that showed secret values.

**How to know it worked:** under **Repository secrets** you see the seven names. GitHub never shows the values again; that is expected.

**Never** create a secret called `ALLOW_DEV_ADMIN`: it turns off the panel login. If it exists, step 8 deletes it and warns you.

## Step 8. Run Setup

1. **Actions** tab → **Setup → Run workflow** → branch `main` → **Run workflow**.
2. Wait 3 to 8 minutes. Open the run to watch the progress.
3. What it does by itself: runs the checks, creates the D1 database and the R2 bucket, saves the database id in `wrangler.jsonc` (a "Set D1 database id" commit by the bot), publishes the app at `https://<GALLERY_HOST>` (creating DNS and the certificate) and uploads the secrets to Cloudflare.
4. At the end, open the **Setup Cloudflare** step and read the **Secrets summary** (names only, never values). Each one must say `present (kept)`, `created` or `uploaded`. If any says `MISSING`, add it in GitHub (step 7) and run Setup again.

**How to know it worked:**
- The run has a green tick.
- `https://<GALLERY_HOST>` opens a page. It shows the logo that comes with the code until you upload yours (step 3), and your `<STUDIO_NAME>` in the text. The first time it can take a few minutes while the certificate is issued.
- `https://<GALLERY_HOST>/admin` takes you to the Cloudflare login screen.

If something does not match, see the matching row in [Common problems](#common-problems) ("opens but shows another logo or name", "does not open", "login loops").

You can run Setup as many times as you want: it deletes nothing and does not change the generated keys.

## Step 9. Domain security settings

In Cloudflare, domain `<ROOT_DOMAIN>`:

| Where | What |
|---|---|
| SSL/TLS → Edge Certificates | **Always Use HTTPS**: on. **HSTS**: on (max-age 6 months, include subdomains), only if **all** your subdomains work over https. Leave "preload" off. |
| Speed → Optimization (or Content Optimization) | **Rocket Loader**: off. |
| Scrape Shield | **Email Address Obfuscation**: off. |
| Web Analytics / Zaraz | Do not turn them on for `<GALLERY_HOST>`. |

Why: the app only allows its own scripts. Those Cloudflare features add their own scripts and the browser would block them (the gallery could misbehave).

## Step 10. First use

1. Open `https://<GALLERY_HOST>/admin` and log in with `<ADMIN_EMAIL>`.
2. **Ajustes (Settings) → Conectar Google (Connect Google).** Google says "Google hasn't verified this app": click **Advanced → Go to … (unsafe)** and accept the **read-only** permission. It is your own app; the warning is because it did not go through Google's review, which personal use does not need. (The panel is in Spanish by default; there is an ES/EN switch in the sidebar.)
3. In your Drive, create the folder `<DRIVE_FOLDER>` (in **My Drive**). Copy its link (right click → **Share → Copy link**; no need to share it with anyone). In **Ajustes**, paste the link → **Guardar carpeta (Save folder)**.
4. **Sincronizar ahora (Sync now).** Each subfolder of `<DRIVE_FOLDER>` appears as a draft gallery.
5. Open a gallery → **Publicar (Publish)** → under **Compartir (Share)**, copy the link or download the QR code.

**How to know it worked:** the link `https://<GALLERY_HOST>/<gallery-name>` opens the gallery in a private window. If it does not, see "The gallery link does not open in a private window" in [Common problems](#common-problems).

Note: the panel shows dates and times in **Buenos Aires time** (UTC−3). If you are in another time zone, keep it in mind when setting expiry dates.

## Step 11. Capture One and Drive for desktop

Each gallery is a folder inside `<DRIVE_FOLDER>`, with one subfolder per size. Capture One makes everything with a single "Process".

Create these Process Recipes, all enabled, format **JPEG**, profile **sRGB**:

| Recipe (= folder name) | Size | Suggested quality | What for |
|---|---|---|---|
| `high-res` | 2048 px long edge | 90 | **required** |
| `web` | 1200 px long edge | 85 | |
| `ig` | 1080 px long edge | 85 | optional (without it there is no "Instagram" download) |
| `thumb` | 600 px long edge | 75 | grid |
| `preview-wm` | 2048 px, watermarked | 90 | optional: galleries in "Proof" mode |
| `thumb-wm` | 600 px, watermarked | 75 | optional: grid in "Proof" mode |

- **Output Location** of each recipe: the `<DRIVE_FOLDER>` folder inside Drive for desktop. In **Sub Folder** type the `[Session Name]` token (tokens button next to the field), a `/` and the recipe name. Example: `[Session Name]/high-res`.
- Result: `<DRIVE_FOLDER>/<Session>/high-res`, `<DRIVE_FOLDER>/<Session>/web`, and so on.
- **Sets** (sections): a subfolder with the same name inside each recipe (`high-res/Ceremony`, `web/Ceremony`…). Loose files go to "Highlights".
- **File names** must be the same across all recipes.

**Drive for desktop:** sync `My Drive/<DRIVE_FOLDER>` (mirror or stream, both work).

**How to know it worked:** the session folder shows up on drive.google.com with the recipe subfolders, and after **Sync now** (or waiting up to 15 minutes) the gallery appears in the panel.

---

## Maintenance

- **Update the app:** when the owner publishes a new version, in your repository click **Sync fork → Update branch**. The **Deploy** workflow publishes it by itself. If GitHub offers **Discard commits**, do **not** click it (it would erase your step 3 values): ask the owner for help.
- **Change a secret** (for example a new Google Client secret): update it in GitHub (step 7) and run **Setup** again.
- **Backups:** the photos live in your Drive. The database (galleries, settings, visits, favorites) can be rolled back with **D1 Time Travel**: 7 days on the free plan, 30 days on Workers Paid.
- **See errors:** Cloudflare → **Workers & Pages** → the app's Worker → **Logs / Observability**.

## Common problems

| Symptom | What to do |
|---|---|
| Setup or Deploy fails in **Checks** with `has both custom-domain routes and the vars` | Your copy of the code is not prepared for other people yet (see "Code version" at the top). Tell the owner. |
| Fails in **Checks** with a formatting error (`prettier`, `Code style issues`) in `wrangler.jsonc` | The step 3 edit is not exact. Check that `routes` has exactly the five lines of step 3 (the object open on its own lines, not squeezed into one), with no extra spaces at line ends, and that each line ends with a comma. |
| "Authentication error" or code 10000 | The token lacks a permission or belongs to another account. Check the seven rows of step 6b, that the zone is `<ROOT_DOMAIN>`, and that `CLOUDFLARE_ACCOUNT_ID` is for the same account. |
| Error mentioning R2 (for example "enable R2") | Step 6a is missing. Turn on R2 and run Setup again. |
| "DNS record already exists" / "externally managed DNS records" | A DNS record for `<GALLERY_HOST>` already exists. Delete it under **DNS → Records** and run Setup again. |
| Setup ends with a `MISSING` | That secret is missing in GitHub. Add it (step 7) and run Setup again. |
| Setup fails at "Commit database id" | Run it again. If it keeps failing, under **Settings → Branches** allow `github-actions` to push to `main`. |
| Setup shows as "cancelled" | Run it again (Setup and Deploy share a queue). |
| The first Deploy run has a red cross | It can happen until Setup has run (see step 3). Run Setup (step 8) and judge the result of that run. If Setup also fails, open the failed step and look for its message in this table. |
| `https://<GALLERY_HOST>` opens, but shows another logo or another name | The logo and icons are the ones that come with the code until you upload yours (step 3). For the name: check `STUDIO_NAME` in `wrangler.jsonc`, and the name saved in the panel (**Ajustes**), which takes priority. Then run Setup or Deploy again and refresh with Ctrl+Shift+R. |
| The gallery link does not open in a private window | The gallery is still a **draft**, is archived or expired: open it in the panel and **Publicar (Publish)**. If it asks for a PIN, that is normal. Also check the link is `https://<GALLERY_HOST>/<gallery-name>` and that you ran **Sincronizar ahora** (Sync now). |
| `https://<GALLERY_HOST>` does not open | Wait 10–15 minutes (certificate). Check that the domain is **Active** in Cloudflare. |
| The `/admin` login loops or gives 403 / "Unauthorized" | `ADMIN_EMAIL`, `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` do not match step 5, or the email is not the policy's. Fix the secret and run Setup again. |
| Google says `redirect_uri_mismatch` | The step 4 URI is not exactly `https://<GALLERY_HOST>/admin/google/callback`. |
| "Google hasn't verified this app" | Normal. **Advanced → Go to…** Make sure the app is **In production** (in "Testing" the connection stops after 7 days). |
| "Primero elegí una carpeta raíz" (choose a root folder first) | Step 10.3 is missing. |
| CPU error, "too many subrequests" or "too many API requests" while syncing | Large library for the free plan. Move to **Workers Paid (USD 5/month)**. The sync stops without damaging anything. |
| Error 429 / "rate limit" | Google limits Drive calls. Wait a few minutes. |
| Images are slow the first time | Normal: the app copies them to R2 little by little (a few minutes per new gallery). |
| "Cached photos: N / M" does not reach M | That is cache warming: a cron job that runs every minute (free, it does not use your Drive quota) copies the small versions of each new photo to R2, up to 20 photos per minute. A new gallery takes a few minutes to be ready; meanwhile each photo loads from Drive on its first visit. If it does not move, check that both crons (`*/15 * * * *` and `* * * * *`) exist in Cloudflare → the Worker → **Settings → Triggers**. |
| Images do not show | The R2 bucket is missing (the one named under `r2_buckets` in `wrangler.jsonc`). Run Setup again; it creates it if it does not exist. |
| Error when moving between pages of the panel, but not when reloading | The `admin.data` path is missing in your Access application (step 5, item 4). Add it as a third public hostname. |

---

## Agent mode

Instructions for an AI agent with browser and/or terminal access that helps a person follow this guide. The person owns every account; the agent works for them.

### Rules (always)

1. **Permission:** first of all, ask whether the person has **written permission** from the code's owner. If not, **stop**.
2. **Secrets:** never print, log, summarize or repeat a secret (the seven from step 7, the token, the Client secret, `SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY`). **Never** ask the person to paste a secret into the chat. Secrets go from the provider's page to GitHub's secrets page, copied by the person; or through `gh secret set <NAME>` run **by the person in their own terminal**, letting `gh` prompt for the value (input stays hidden) or having the person type it. **Never** pass the value with `--body` or `< file`. Do not use `set -x`, `echo` of secret variables, or temporary files holding secrets.
3. **Consent:** logging in, accepting terms, adding payment methods, changing nameservers, publishing the Google app ("In production") and accepting the Google permission in step 10 are done **by the person**. You can guide and show where to click, but do not do them without the person confirming at that moment.
4. **Do not change app code** or tests. The only file you edit is `wrangler.jsonc` (step 3) and, if the person asks, the logos. Never create `ALLOW_DEV_ADMIN` in production or commit `.dev.vars`.
5. **Idempotence:** before creating anything, check whether it already exists. Setup can be repeated.
6. **At the end**, deliver a report with: the galleries address, which steps are done, which checks passed and any open problem. No secret values.

### Agent step 0: ask

Ask the person (these are not secret) for the values in the [Your values](#your-values) table: `<STUDIO_NAME>`, `<ROOT_DOMAIN>`, `<GALLERY_HOST>`, `<ADMIN_EMAIL>`, `<DRIVE_FOLDER>`, `<ACCESS_TEAM>`, `<GOOGLE_PROJECT>`, `<GITHUB_USER>`, optionally `<CONTACT_EMAIL>`, and the address of the original repository. Confirm:
- `<GALLERY_HOST>` ends in `.<ROOT_DOMAIN>` and is not in use.
- `<ADMIN_EMAIL>` is the email of their Cloudflare account.
- `<STUDIO_NAME>` has no double quotes or backslashes.

### Who does what

| Step | Agent via CLI/API | Agent in the browser (in the person's session) | Person only |
|---|---|---|---|
| 1 Fork | **Ask the person first** (this creates a repository in their account), then `gh repo fork <owner>/<repo> --default-branch-only --clone=false` (after the person runs `gh auth login`) | Enable Actions in the fork | GitHub login |
| 2 Domain | Check nameservers with `dig` | Add the domain in Cloudflare | Change nameservers at the registrar; payment method |
| 3 Config | Edit `wrangler.jsonc`, `prettier --check`, commit and push | or edit on the GitHub website | — |
| 4 Google | `gcloud projects create <GOOGLE_PROJECT>` and `gcloud services enable drive.googleapis.com --project <GOOGLE_PROJECT>` (if the person already ran `gcloud auth login`) | Branding, Audience, Data Access, Clients (no CLI for the web OAuth client) | **Publish app**; copy Client ID/secret into GitHub |
| 5 Access | — | Create the application and the policy | Choose the Free plan; copy the AUD into GitHub |
| 6 Token/R2 | — | Guide token creation with the 7 permissions | Turn on R2 (payment method); copy token and Account ID into GitHub |
| 7 Secrets | `gh secret list` (names only) | — | Paste the values |
| 8 Setup | `gh workflow run setup.yml --ref main`, `gh run watch` | — | — |
| 9 Security | — | Change the four settings | — |
| 10 First use | `curl` checks | Guide | Log in, accept the Google permission |
| 11 Capture One | — | — | Everything (it is on their computer) |

### Checks (after each step)

Replace the values between `< >`. None of these commands shows secrets.

```sh
# 1: the fork exists and has the three workflows
gh repo view <GITHUB_USER>/<repo> --json name,isFork
gh workflow list --repo <GITHUB_USER>/<repo>          # CI, Deploy, Setup

# 2: the domain uses Cloudflare nameservers
dig +short NS <ROOT_DOMAIN>                            # ends in .ns.cloudflare.com.

# 3: the configuration is valid and formatted as expected (in a local clone, with pnpm installed)
pnpm install --frozen-lockfile && pnpm exec prettier --check wrangler.jsonc
grep -n '"routes"\|STUDIO_NAME\|PUBLIC_ORIGIN\|LEGACY_HOSTS' wrangler.jsonc

# 7: the seven secrets exist (names only)
gh secret list --repo <GITHUB_USER>/<repo>

# 8: Setup finished and nothing is MISSING
gh run list --repo <GITHUB_USER>/<repo> --workflow setup.yml --limit 1
gh run view <RUN_ID> --repo <GITHUB_USER>/<repo> --log | grep -E 'present|created|uploaded|MISSING|deleted'

# 8: the app answers, the panel is protected
curl -sS -o /dev/null -w '%{http_code}\n' https://<GALLERY_HOST>/            # 200
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<GALLERY_HOST>/admin   # 302 to <ACCESS_TEAM>.cloudflareaccess.com
curl -sS -o /dev/null -w '%{http_code}\n' https://<GALLERY_HOST>/api/admin/sync # 302 or 403, never 200
curl -sS -o /dev/null -w '%{http_code}\n' https://<GALLERY_HOST>/privacy     # 200

# 9: https enforced
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://<GALLERY_HOST>/   # 301 to https
```

The Setup log filtered with `grep` only shows secret names and their status; GitHub also masks the values. **Always** pipe `gh run view --log` through `grep` as above and never print the full log.

### Stop conditions

Stop and explain to the person what happened (without secrets) if:

- There is no written permission from the code's owner.
- The domain is not **Active** in Cloudflare after 24 hours.
- `prettier --check` fails after two attempts at editing `wrangler.jsonc`.
- Before step 8, the fork does not contain the code fix described at the top (tests that no longer check the original owner's domain), or Setup fails in **Checks** because of a test (not formatting): the copy of the code needs a new version from the owner. Do not modify the tests.
- Setup fails twice in a row with the same Cloudflare permissions error.
- A step asks for something that is not in this guide (another permission, another payment, another kind of account).
- Any tool is about to display a secret value.
- `https://<GALLERY_HOST>/admin` answers 200 without going through the Cloudflare login: **this is a security failure**. Removing the domain from the Worker (Cloudflare → Workers & Pages → the Worker → **Settings → Domains & Routes** → remove `<GALLERY_HOST>`) is **an explicit "ask the person first"**: explain the problem, let them decide and do it, and ask them to tell the code's owner.
