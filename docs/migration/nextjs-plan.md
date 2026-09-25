# Pāreja uz Next.js — darba plāns (B variants)

Mērķis: viena Next.js (App Router) aplikācija, kas aizstāj Express API (`app/src`)
un vanilla JS UI (`app/public/index.html`). Datubāzes shēma **paliek tā pati**, lai
esošā Supabase datubāze un dati strādā bez migrācijas. API ceļi un JSON formas
paliek tādi paši, lai pāreju var pārbaudīt, salīdzinot abas aplikācijas.

Darbi sakārtoti no mazākā uz lielāko. Katrs posms beidzas ar zaļiem testiem un
atsevišķu commit, lai progresu var pārskatīt pa daļām.

## Posms 0 — Drošības labojumi esošajā aplikācijā (mazs)

Šie ir kritiski jau tagad un vēlāk kalpo kā specifikācija jaunajai aplikācijai.

1. `/api/stats` nesūta klienta vārdus un SMS kodus bez `field.customer` / `field.sms`.
2. `/api/pending`, `/api/release-lookup`, `/api/export/pending`, `/api/export/spots`
   izņem laukus pēc lietotāja tiesībām.
3. `/api/storage/:id/events` — rediģēšanas vēsturē neparādās slēptie lauki
   (telefons, vārds, cena, SMS kods).
4. `/api/login` — ierobežots mēģinājumu skaits (brute-force aizsardzība).
5. 500 kļūdas klientam vairs nerāda iekšējo `err.message`.
6. Izdzēsts nelietotais `public/app.js` un `public/styles.css`.

## Posms 1 — Next.js karkass (mazs/vidējs)

- `web/`: Next.js 16, React 19, TypeScript strict, ESLint, Vitest.
- Datubāze: Drizzle ORM ar shēmu, kas **precīzi** atbilst esošajām tabulām.
  Produkcijā `pg` (Supabase), lokāli un testos **PGlite** (īsts Postgres procesā),
  tāpēc SQLite un Google Sheets glabātuves vairs nav vajadzīgas.
- Bāzes migrācija ir idempotenta (`IF NOT EXISTS`), tāpēc tā droši iziet uz esošās
  produkcijas datubāzes.
- CI: GitHub Actions — typecheck, lint, testi, build.

## Posms 2 — Domēna loģika un testi (vidējs)

Tīras funkcijas bez ietvara, ar unit testiem:
cenas, tiesības un lauku slēpšana, vietu karte (`spotUniverse`), konteineru
validācija, pārnumurēšana, vēsture, analītika, klienti, Excel imports/eksports.

## Posms 3 — API kā Route Handlers (liels)

Visi ~70 endpointi pārnesti uz `web/src/app/api/**/route.ts` ar kopīgu
`handler({ perm })` apvalku: autentifikācija, tiesības, kļūdas. Integrācijas testi
pret PGlite. JWT saderīgs ar esošo (`AUTH_SECRET`, sīkdatne `r1_session`), tāpēc
pēc pārslēgšanas lietotāji netiek izrakstīti.

## Posms 4 — UI ekrāni React (lielākais)

No vienkāršākā uz sarežģītāko:

1. Pieteikšanās, izvēlne, galvene, tiesību pārbaude maršrutos
2. Instrukcija (statiska), Sākums
3. Sagatavotie, Vēsture, Analītika
4. Izsniegt glabāšanu, ieraksta kartīte (bildes, komentāri, drukāšana)
5. Tabula, Klienti
6. Noliktava (uzdevumi, polling, push)
7. Iestatījumi, Lietotāji (tiesību dialogs)
8. Jauna glabāšana (typeahead, cena, SMS logs)
9. Novietnes un konteineru formas redaktors

## Posms 5 — PWA, izvietošana, pārslēgšana (vidējs)

- Service worker un manifests jaunajiem maršrutiem; vecās `/?view=` saites turpina strādāt.
- Playwright pārbaude galvenajām plūsmām pārlūkā.
- Dokumentācija: Vercel Root Directory `app` → `web`, vides mainīgie nemainās.
- Pēc tam, kad produkcijā viss pārbaudīts: izdzēst `app/` (Express).

## Apzināti atlikts

- Bilžu pārnešana no Postgres `BYTEA` uz Supabase Storage (datu migrācija, vajag
  piekļuves atslēgas).
- Normalizētā shēma no `db/migrations/001_init.sql` (klienti, auto, riepu komplekti).
