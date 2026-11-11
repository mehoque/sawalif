# Sawalif with Noura

A private voice tutor for spoken Saudi (Najdi) Arabic. Noura talks with you through the microphone, mixes English and Arabic, quizzes you, shows each word with its letters, and remembers your strengths and weak spots between sessions.

- **Brain:** Claude, called from a private server function (your API key never reaches the browser).
- **Voice out:** the browser's Arabic voice. Microsoft Edge has the most natural free Saudi voices (Hamed, Zariyah).
- **Voice in:** Chrome or Edge speech recognition with Saudi Arabic (`ar-SA`) or English.
- **Memory:** stored privately in Cloudflare KV under your verified email, with 30 days of daily backups.
- **Privacy:** Cloudflare Access puts a sign-in wall in front of the whole site; the server also re-checks the sign-in token and an email allowlist on every call.

## Layout

```
public/index.html            the app
functions/api/_middleware.js verifies the Cloudflare Access sign-in on every API call
functions/api/tutor.js       calls Claude (prompt caching on, daily call cap)
functions/api/memory.js      loads and saves your learner memory
```

## Setup (about 20 minutes, one time)

### 1. Claude API key
1. Go to <https://console.anthropic.com>, sign in, and add a payment method under **Billing**.
2. Under **Billing > Limits**, set a monthly spend limit (for example $20).
3. Under **API keys**, create a key named `sawalif` and copy it.

### 2. Deploy on Cloudflare Pages (free)
1. Create a free account at <https://dash.cloudflare.com>.
2. **Workers & Pages > Create > Pages > Connect to Git.** Authorize GitHub, give access to this repository, and select it.
3. Build settings: Framework preset **None**, Build command **empty**, Build output directory **`public`**. Click **Save and Deploy**.
   Note the address it gives you, for example `sawalif.pages.dev`.

### 3. Memory storage
1. **Storage & Databases > KV > Create namespace**, name it `sawalif-memory`.
2. Open your Pages project > **Settings > Bindings > Add > KV namespace**. Variable name **`MEMORY`**, namespace `sawalif-memory`.

### 4. Lock it to you (Cloudflare Access, free for up to 50 users)
1. In the dashboard open **Zero Trust**. Pick a team name (for example `hoque`) and the **Free** plan.
2. **Access > Applications > Add an application > Self-hosted.**
   - Application domain: `sawalif.pages.dev`. Add a second domain `*.sawalif.pages.dev` so preview builds are locked too.
   - Policy: **Allow**, Include > **Emails** > your email address.
   - Login method: **One-time PIN** (a code is emailed to you).
3. Save, then open the application's **Overview** and copy the **Application Audience (AUD) Tag**.

### 5. Settings for the server
In the Pages project: **Settings > Variables and Secrets** (Production), add:

| Name | Value | Type |
|---|---|---|
| `ANTHROPIC_API_KEY` | the key from step 1 | Secret |
| `ACCESS_TEAM` | your Zero Trust team name, e.g. `hoque` | Text |
| `ACCESS_AUD` | the AUD tag from step 4 | Text |
| `ALLOWED_EMAILS` | your email (comma-separate to add more) | Text |
| `DAILY_LIMIT` | optional, default `400` calls per day | Text |
| `MODEL_DEFAULT` | optional, default `claude-sonnet-5-5` | Text |
| `MODEL_QUICK` | optional, default `claude-haiku-5-5` | Text |

Then **Deployments > Retry deployment** (settings apply on the next deploy).

### 6. Use it
Open `https://sawalif.pages.dev` in **Chrome or Edge**, enter the emailed code, allow the microphone, and press **Start session**. On a phone, add it to your home screen.

## Cost
Roughly $6–12 a month with Sonnet for 20 half-hour sessions, about $1 with the Haiku setting (Settings > Tutor replies). Speech, hosting, sign-in and storage are free. The Console spend limit and `DAILY_LIMIT` cap the worst case.

## Troubleshooting
- **"Not authorized" from the API:** the four variables in step 5 don't match (team name, AUD tag, or email), or you deployed before adding them.
- **Mic does nothing in Arabic:** use Chrome or Edge on a computer, check the site's microphone permission (lock icon in the address bar). Safari and Firefox lack reliable Arabic recognition; use your device's dictation into the text box instead.
- **Robotic Arabic voice:** open the site in Microsoft Edge and pick a "Natural" Saudi voice in Settings.
- **Restore an older memory:** in KV, copy a `backup:<email>:<date>` value over `mem:<email>`.
