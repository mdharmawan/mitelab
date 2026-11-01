# Chasm & Curve · MITE Lab

A multiplayer web simulation for MBA classes. Teams run **MITE Lab** and take **MITE Mesh**, a fictional wireless power-and-data network, from its first users to the mass market over 8 to 12 simulated years. The engine is built on Rogers (who adopts), Bass (how fast) and Moore (where growth stalls). The full specification is the PRD in the claude.ai project "Web based MITE 2.0".

MITE stands for **Management of Innovation, Technology, and Entrepreneurship**.

## What is in this version

- **Multiplayer**: 2 to 6 teams share one market. Category growth pools every team's marketing (p) and references (q). Each team's share of new buyers in a cell equals its attractiveness (fit, price, references, whole product, presence) divided by all teams' combined attractiveness (PRD §10).
- **Single-player**: each team runs its own market at its own pace. Any signed-in user can also start a **practice run** alone.
- **Teams**: students join with a six-character code. Teams can be self-chosen or assigned by the instructor. The captain submits; every member edits the plan and sees changes live.
- **Instructor console**:
  - Setup covers preset, rounds, timer, seed capital, market size per vertical, Bass p and q, events, hints, gradual unlocks, randomness and seed.
  - Live view shows submit status, budget split, cash, adoption, stage and alerts for every team.
  - Pacing controls: pause, resume, extend the timer, run the year, open the next year, broadcast a message.
  - Rewind to any year: the old run is kept and the replay is marked as practice.
  - Teaching assistants can be view-only or allowed to control pacing.
- **Debrief**: DEB-1 to DEB-8, each labelled with its theory concept and a discussion question.
  - DEB-1 shows every team against the textbook Bass curve.
  - DEB-7 compares two teams side by side.
  - Event markers appear on the timelines.
  - Also included: a facilitation guide, team reflections, CSV export and print-to-PDF.
- **English and Bahasa Indonesia**:
  - Every player switches language at any time, and the instructor sets the session default.
  - In Bahasa Indonesia, core theory terms show the English original in brackets on first use, e.g. "Jurang (chasm)".
  - CSV files keep stable English column keys, with a second header row in the exporter's language.
- **About page**: what the game is, what MITE stands for, the theories, the learning objectives, profiles of the three people behind the game, and the model documentation.
- **Sign-in**: Google accounts. Only allow-listed Google accounts can run sessions.

## Deploy on Render (about US$13/month)

You need: this repo on GitHub, a Render account, and a Google Cloud project.

### 1. Create the Google sign-in client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **OAuth consent screen**.
2. Choose **External**, then fill in the app name ("Chasm & Curve"), your support email and your developer email. Add the scopes `openid`, `email` and `profile`, then **Publish app**. While the app stays in "Testing", only the test users you list can sign in.
3. Go to **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
4. Under **Authorized JavaScript origins**, add your Render address once you have it (step 2), e.g. `https://mitelab.onrender.com`. Add any custom domain too. No redirect URI is needed.
5. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.

### 2. Create the service from the blueprint

1. In Render: **New +** → **Blueprint** → connect GitHub → pick `mdharmawan/mitelab`.
2. Render reads `render.yaml` and creates:
   - **mitelab**: a Starter web service, always on, in Singapore.
   - **mitelab-db**: a Basic Postgres database.
3. When asked, fill in:
   - `GOOGLE_CLIENT_ID`: the Client ID from step 1.
   - `INSTRUCTOR_EMAILS`: your Google account, e.g. `mdharmawan@gmail.com`. Separate several with commas. These people are administrators and can add other instructors from **Menu → Instructors**.
   - `CONTACT_EMAIL`: optional, shown on the About page.
4. Click **Apply**. The first deploy takes a few minutes. Open the service URL; `/healthz` should answer `{"ok":true,"store":"postgres"}`.
5. Go back to Google Cloud and add this exact URL as an authorized JavaScript origin, if you haven't already.

Every push to `main` redeploys automatically.

### 3. Run a class

1. Sign in, then **Set up a session**. Choose the mode, number of teams, rounds, timer, events and default language.
2. Give students the address and the code shown in the lobby. They sign in with Google and enter the code.
3. When the teams are filled, press **Start game**. Use the **Live** tab during play, **Debrief** at the end, and **Runs & export** for the CSV.

## Run it locally

```bash
npm install
DEV_LOGIN=1 INSTRUCTOR_EMAILS=you@example.com npm start   # http://localhost:3000
```

Without `DATABASE_URL`, data is stored as JSON files in `./data`. `DEV_LOGIN=1` adds a name-and-email sign-in form for testing; it is always disabled when `NODE_ENV=production`. To test Google sign-in locally, add `http://localhost:3000` as an authorized origin and set `GOOGLE_CLIENT_ID`. You can also put settings in a `.env` file and run `node --env-file=.env server/index.js`.

```bash
npm test   # engine equivalence, multiplayer balance and replay, translation coverage
```

## Editing content

| What | Where |
| --- | --- |
| About page profiles, photos, links | `public/content/about.js`. Put photos in `public/content/photos/` and set `photo: '/content/photos/name.jpg'` |
| English text | `public/i18n/en.js` |
| Bahasa Indonesia text | `public/i18n/id.js`, same keys. `npm test` fails if any key is missing or a `{placeholder}` differs |
| Engine parameters and presets | `shared/engine.js` (`BASE`, `PRESETS`) |

Per the PRD, each person approves their profile text and photo, and native-speaking faculty sign off the Bahasa Indonesia text before release.

## How it is built

```
shared/engine.js     Simulation engine, runs in Node and the browser. Deterministic: same seed + decisions = same results
server/index.js      Express + Socket.IO: static files, Google sign-in, CSV/audit export, live game events
server/game.js       Sessions, teams, roles, rounds, rewind, views per role
server/store.js      Postgres (Render) or JSON files (local)
server/auth.js       Google ID-token check, signed session cookie
server/export.js     CSV with stable keys and localized labels
public/              Single-page client (no build step): js/, i18n/, content/, styles.css
test/                Engine equivalence, multiplayer balance, i18n coverage
render.yaml          Render blueprint
```

Markets are never stored directly. The server stores every team's decisions per year and rebuilds markets by replay. That is what makes rewind exact and lets the audit log (`Runs & export → Audit log`) reproduce every result.

## Notes and limits

- One server process holds live sessions in memory and writes to Postgres. That suits the PRD's scale of 120 players per session and 50 sessions; running several instances would need a shared Socket.IO adapter.
- Parameter values are design defaults from the PRD, balance-tested with scripted strategies. They need calibration in a pilot.
- PDF export uses the browser's print dialog ("Save as PDF").
- Not yet built (PRD "Should"/"Could"): team sandbox reruns (INS-10), the pre/post concept quiz, LMS integration.
