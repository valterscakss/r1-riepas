# R1 Tires — Phase 1 MVP: Requirements Review & Risk Assessment

**Reviews:** SRS v1.0 (2026-07-20)
**Purpose:** Challenge the SRS on production-readiness, security, and data safety
before implementation. Every item references the SRS clause it addresses.
**Severity legend:** 🔴 Blocker · 🟠 High · 🟡 Medium

> This is a critique-to-improve document. The SRS is a strong *feature* description;
> the items below are the gaps between "describes the features" and "safe to run in
> production with real customer data."

---

## 1. Summary

| Area | Verdict |
| :- | :- |
| Feature coverage (intake / retrieval / SMS) | Good — well specified |
| Data model completeness | Incomplete — missing `users`, pricing config; per-tire depth mismatch |
| Security model | Underspecified — auth data model, endpoint authz, webhook validation missing |
| Data safety / backups | Partially specified — needs PITR, immutable backups, pre-go-live restore drill |
| GDPR / compliance | Contradictory — indefinite retention vs. right to erasure |
| Timeline vs. scope | Unrealistic for the full NFR set in 6 weeks — phase the NFRs |
| Infra choice | Likely over-built for the load — challenge before committing |

---

## 2. 🔴 Critical findings (go-live blockers)

### C1 — No user / staff table in the schema
The SRS requires login, RBAC with four roles (Admin/Manager/Staff/Read-Only,
§3.4, §12.1), and `audit_log.user_id` (§6.1), but **no `users` table is defined**.
The authentication mechanism (session vs. token), password reset flow, and API
auth scheme are all unspecified.

**Action:** Add a `users` table (id, phone, name, password_hash, role, status,
failed_login_count, locked_until, last_login_at, timestamps). Define session
handling, password reset, and the API auth scheme (see C4).

### C2 — Spot assignment race condition
FR-2.2.5 "find first available spot" run by 10 concurrent staff (§3.3) will assign
the **same** spot to two intakes. This corrupts physical inventory tracking.

**Action:** Allocate spots inside a transaction with `SELECT … FOR UPDATE SKIP
LOCKED`, or enforce a partial unique constraint on the occupied location and retry
on conflict. Add a concurrency test to the go-live gate.

### C3 — Per-tire thread depth contradicts the schema
FR-2.3.3 and Use Case 3 require thread depth **per tire** (e.g. 4.2mm + 5.1mm for a
mixed set), but `tire_sets` stores a single `intake_thread_depth_mm` /
`retrieval_thread_depth_mm` (§6.1). The `tire1_*` / `tire2_*` column pairs also cap
the model at two groups and can't hold per-item depth.

**Action:** Replace the `tire1_*`/`tire2_*` columns with a `tires` child table
(tire_set_id, position, size, brand, quantity, intake_depth_mm, retrieval_depth_mm).

### C4 — Endpoints have no authentication / authorization defined
The API in §7 shows no auth. `GET /api/v1/tire-sets/by-code/:code` returns customer
name, location, and tire details. If reachable without a staff session, 6–8-char
codes are enumerable → PII disclosure / IDOR. `GET /customers/search?phone=` is a
PII lookup with the same exposure.

**Action:** All endpoints require an authenticated staff session; enforce RBAC per
endpoint; rate-limit lookup endpoints; never expose customer-facing lookup by code.

### C5 — Twilio status webhook is unauthenticated
`POST /api/v1/webhooks/sms/status` (§7.1) accepts delivery status from anyone.

**Action:** Validate the `X-Twilio-Signature` header on every webhook call; reject
unsigned/invalid requests.

### C6 — GDPR contradiction: indefinite retention vs. right to erasure
FR-2.5.2 says "keep all records indefinitely, never delete"; §3.4/§12.7 promise the
GDPR right to erasure and "7 years minimum" retention. These conflict. Indefinite
retention of personal data without a lawful basis violates the storage-limitation
principle (this is an EU/Latvia deployment).

**Action:** Define a written retention schedule with a lawful basis, an erasure
workflow that honors legal holds (anonymize rather than break referential
integrity), and reconcile the "indefinite" wording. Get this reviewed before launch.

---

## 3. 🟠 Data safety & backups

The SRS specifies daily → S3, multi-region, RPO<1d, RTO<4h, AES-256, quarterly
restore tests (FR-2.5.3, §12.2). Good baseline. Gaps:

- **B1 — RPO<1 day loses up to 24h of intakes.** For inventory tracking this is too
  loose. Enable **RDS Point-in-Time Recovery (~5-min RPO)** in addition to daily
  snapshots.
- **B2 — Backups must be immutable/versioned.** Without S3 Object Lock + versioning,
  a ransomware event or accidental delete destroys the backups too.
- **B3 — Restore drill must run before go-live, and on the migrated dataset** — not
  quarterly-only. A backup you have never restored is a hope, not a backup.
- **B4 — Back up non-DB assets:** the source Excel files (pre- and post-migration)
  and captured digital signatures (FR-2.3.4).
- **B5 — Migration is the highest-risk data event.** "0% loss" (FR-2.5.1) needs a
  mechanism: source backup → dry-run → validation → dedup → reconciliation counts →
  rollback → sign-off. Rehearse on a copy before touching production.

---

## 4. 🟠 Security hardening gaps

- **S1 — Secrets are self-contradictory:** "environment variables only" (§9.1, §12.2)
  vs. "AWS Secrets Manager" (§12.2). Standardize on Secrets Manager/SSM; keep no
  secrets in env dumps, logs, or the repo. Add secret-scanning to CI.
- **S2 — No SAST / dependency audit / secret scan in CI** (§11.3 lists only tests).
  Add `npm audit`, a SAST step, and secret scanning to the pipeline.
- **S3 — Session lifetime 8h on a shared staff kiosk** (§12.1) is long. Add an idle
  timeout and re-authentication for sensitive operations; consider device binding.
- **S4 — MFA "optional, not required"** (§3.4). Acceptable for Staff at MVP, but
  Admin accounts should require MFA — an Admin compromise exposes all customer data.
- **S5 — Audit log integrity** (§6.1): make it append-only / tamper-evident and
  restrict read access (it contains PII).
- **S6 — Input normalization is load-bearing for correctness, not just safety:**
  phones must be canonicalized to E.164 or the `UNIQUE` constraint is meaningless
  (`29123456` vs `+37129123456`); license plates uppercased/trimmed; tire size
  validated by regex.
- **S7 — SMS opt-out / sender registration:** Latvia requires registered sender IDs
  and STOP/opt-out handling (e-Privacy). "99% delivery" is not fully controllable —
  Twilio can't guarantee carrier delivery. Treat SMS as best-effort with the manual
  fallback already specified (§9.1).

---

## 5. 🟠 Schema & API corrections

- **D1 — Circular FK:** `tire_sets.location_id NOT NULL → storage_locations` and
  `storage_locations.current_occupant_id → tire_sets` create an insert ordering
  problem. Make `current_occupant_id` nullable and set it within the same
  transaction as the intake; null it on release.
- **D2 — Pricing is "configurable" but has no table.** FR-2.2.6 / FR-2.6.3 require
  configurable price tiers and rim surcharges. Add a `pricing_rules` table with an
  effective date, and audit changes. Parsing width from `"235/50/19"` is brittle —
  validate and map via the table, not string math.
- **D3 — No soft-delete column** despite "never delete, mark inactive"
  (FR-2.5.2). Add `deleted_at` / status handling consistently.
- **D4 — `season VARCHAR` free text** invites inconsistent data ("Spring 2026" vs
  "spring 26"). Constrain or structure it.
- **D5 — List endpoints lack pagination and authz** (`/locations/available`,
  §7.1). Add both.
- **D6 — No stated API auth scheme / versioning discipline / error contract beyond
  one example.** Define the auth header, standard error envelope, and validation
  error shape once.

---

## 6. 🟠 Production-readiness & scope

- **P1 — Timeline vs. scope.** 6 weeks (wks 3–8) for full-stack + Twilio + migration
  + RBAC + 99.5% uptime + Multi-AZ + auto-scaling + multi-region backup + 80% tests +
  UAT is not realistic. **Recommendation:** security and backups are non-negotiable
  from day one; **defer** auto-scaling, multi-region replica, and CDN until real load
  justifies them (see build plan).
- **P2 — Infra likely over-built.** EC2 auto-scaling + Multi-AZ RDS for 300 customers
  / 10 concurrent users (§3.3) is heavy and costly. A managed runtime (ECS Fargate /
  App Runner or a PaaS) + managed Postgres keeps EU data residency (Frankfurt/Ireland,
  §11.2) while cutting ops burden. Decide before committing IaC.
- **P3 — Observability is thin.** You cannot hit or prove 99.5% uptime (§13) without
  health checks, uptime monitoring, structured logs, and error tracking (e.g.
  Sentry). Add these in Increment 0.
- **P4 — "Penetencies" (§10.5)** security testing is a stub — expand into concrete
  checks (authz bypass, injection, XSS, webhook spoofing, TLS enforcement) tied to
  the go-live gate.

---

## 7. Open decisions needed before/early in the build

1. **Hosting:** full AWS (EC2/RDS/S3) as written, or a leaner managed stack? (P2)
2. **Retention & erasure policy:** confirm lawful basis, retention period, and
   erasure/anonymization approach with whoever owns compliance. (C6)
3. **MFA for Admin:** in for MVP or fast-follow? (S4)
4. **Stack confirmation:** SRS says Node 18+ / React 18+ / PostgreSQL 14+ (§11.1) —
   confirm before scaffolding, plus ORM (Sequelize/TypeORM per §12.4).
5. **Digital signature:** stored as image + record — confirm encryption and retention
   given it is personal data. (FR-2.3.4)

---

## 8. What the SRS gets right (keep)

- Clear functional scope with sensible Phase-1 / Phase-2 split.
- Indexes on the hot lookup paths (phone, plate, sms_code, location, status).
- Audit trail intent and 7-year retention framing.
- Manual retrieval fallback when SMS fails (§9.1) — the right resilience posture.
- Concrete performance targets and acceptance criteria to test against (§13, §14).
