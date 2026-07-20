# R1 Tires — Phase 1 MVP: Phased Build Plan

**Companion to:** `requirements-review.md`
**Principle:** Ship in thin, independently verifiable increments. **Security,
auditing, and backups are foundational (Increment 0), not a later phase.** Each
increment has an explicit *gate* that must pass before the next starts.

> Corresponds to SRS "Phase 1 (MVP)". SRS "Phase 2+" items (dashboard, reporting,
> payments, customer portal, SMS reminders) remain out of scope.

---

## Guiding rules

- **No real customer data touches the system until Increment 0's restore drill
  passes.** A backup that has never been restored does not count.
- **Every increment is deployable** to staging and demoable.
- **Security is built in, not bolted on** — authz, input validation, and audit
  logging land with the first feature, not at the end.
- **Defer scale, not safety.** Auto-scaling, multi-region backup replicas, and CDN
  are deferred until real load justifies them; TLS, RBAC, PITR backups, and audit
  logging are not deferrable.

---

## Increment 0 — Foundation & safety net
*Goal: a deployable skeleton that is secure and recoverable before it holds any data.*

- Monorepo layout, README, coding standards.
- CI pipeline: lint → unit tests → **SAST + secret scan + `npm audit`** → build.
  (Closes S2.)
- IaC skeleton for the chosen hosting (pending decision P2); EU region.
- PostgreSQL + migration framework (versioned, reversible).
- **`users` table + auth** (bcrypt ≥10 rounds, sessions with idle timeout, account
  lockout after 5 fails) + **RBAC middleware** for the 4 roles. (Closes C1, S3.)
- `audit_log` wired as append-only, PII-access-restricted. (Closes S5.)
- Baseline web security: HTTPS/HSTS, CSP, CSRF tokens, parameterized queries via ORM.
- Secrets in Secrets Manager/SSM — none in env dumps, logs, or repo. (Closes S1.)
- **Backups from day one:** automated daily snapshot **+ PITR (~5-min RPO)**,
  S3 Object Lock + versioning (immutable), AES-256. (Closes B1, B2.)
- Observability: health checks, uptime monitor, structured logging, error tracking.
  (Closes P3.)

**🚦 Gate:** Deploy to staging; run a **full backup → restore drill on an empty DB**
and confirm it succeeds; auth + RBAC enforced on a protected test route; CI green
including security steps. (Closes B3 for the empty case.)

---

## Increment 1 — Customers, vehicles, locations
*Goal: the core entities and fast lookups the rest of the app depends on.*

- `customers`, `vehicles`, `storage_locations` tables + migrations.
- Customer CRUD + search by phone; vehicle lookup by plate.
- **Input normalization:** phone → E.164 (uniqueness depends on it), plate
  uppercase/trim, tire-size regex validation. (Closes S6.)
- Seed storage locations (A1–D…); availability query with pagination + authz.
  (Closes D5.)
- Company vs. individual classification (FR-2.1.4).

**🚦 Gate:** Phone/plate lookup < 1s (FR-2.1.2); all writes audited; validation
rejects malformed phone/plate/size.

---

## Increment 2 — Intake core (SMS stubbed)
*Goal: complete an intake end-to-end except the SMS send.*

- **`tires` child table** for per-tire size/brand/qty/depth. (Closes C3.)
- **`pricing_rules` table** + pricing engine (size tier × rim multiplier), with an
  effective date and change auditing. (Closes D2.)
- **Transactional spot assignment** (`FOR UPDATE SKIP LOCKED` or unique-constraint +
  retry). (Closes C2.)
- Resolve the circular FK: `current_occupant_id` nullable, set within the intake
  transaction. (Closes D1.)
- Intake form (FR-2.2.3) with real-time validation; confirmation screen (FR-2.2.8);
  full intake audit trail (FR-2.2.9). SMS send is a stub that records intent.

**🚦 Gate:** **Concurrency test** — N parallel intakes never double-assign a spot;
pricing exact to €0.01 across all size/rim combinations.

---

## Increment 3 — SMS + retrieval
*Goal: notify customers and return their tires.*

- Twilio send with retry (≤3), opt-out/STOP handling, registered sender. (Closes S7.)
- **Signed status webhook** — validate `X-Twilio-Signature`. (Closes C5.)
- Retrieval by SMS code and by license plate (FR-2.3.1/2) — **staff-authenticated,
  rate-limited, never customer-facing.** (Closes C4.)
- Per-tire retrieval depth + automatic degradation calc (FR-2.3.3).
- Digital sign-off capture, stored encrypted with a defined retention. (FR-2.3.4.)
- Release flow: mark released, free the spot, send confirmation SMS.

**🚦 Gate:** 99% send success in a test batch; code-lookup requires auth + resists
enumeration (rate limit + no PII on unauthenticated paths).

---

## Increment 4 — Data migration from Excel
*Goal: move existing customers/tire sets in with zero loss — run late, against a
frozen schema, but rehearsed early.*

- Importer: source backup → **dry-run** → validation → dedup (phone + plate) →
  reconciliation report (counts in vs. out, flagged rows) → **rollback** path.
- Rehearse on a copy; then run against staging.
- **Restore drill on the migrated dataset.** (Closes B3 for real data, B4, B5.)

**🚦 Gate:** Reconciliation shows 100% of valid rows imported, invalid rows flagged
(not silently dropped), and operations sign-off. (FR-2.5.1.)

---

## Increment 5 — Hardening, UAT & go-live
*Goal: prove the NFRs and hand over.*

- Load/perf test to §13 targets (10 concurrent users, lookups < 1s, API < 200ms avg).
- Security test: authz bypass, SQL injection, XSS, webhook spoofing, TLS enforcement.
  (Closes P4.)
- Monitoring + alerting live (error rate, SMS success, DB disk, server down).
- Runbook + on-call plan; staff training.
- Pilot with 10–20 customers; final backup restore drill on a prod-like copy.

**🚦 Gate:** SRS §14 acceptance criteria met; sign-offs from Technical Lead,
Operations Manager, and Business Owner.

---

## Cross-cutting workstream — living documentation

Documentation is maintained **every increment**, not written once at the end. A
feature is not "done" until its docs are updated in the same PR. Owned artifacts:

| Doc | Kept current | Location |
| :- | :- | :- |
| **API reference (OpenAPI 3.1)** | The source of truth for every endpoint; generated/validated in CI | `docs/api/openapi.yaml` |
| **Architecture overview + diagrams** | Components, data flow, trust boundaries | `docs/architecture/` |
| **Data model / ERD** | Updated with each migration | `docs/architecture/data-model.md` |
| **Runbook** (deploy, rollback, restore, on-call) | Updated as ops procedures change | `docs/runbook/` |
| **ADRs** (architecture decision records) | One per significant decision (hosting, ORM, auth, retention) | `docs/adr/` |
| **Staff user guide** | Intake/retrieval walkthroughs for training (§3.6: operate in 2h) | `docs/user-guide/` |
| **CHANGELOG** | Per release | `CHANGELOG.md` |

**Gate addition (all increments):** the increment's docs are updated in the same PR;
CI fails if the OpenAPI spec drifts from the implemented routes.

## Integration APIs — see `integration-api-plan.md`

Planning the app's inbound/outbound APIs for connecting to other systems (vehicle
registry, accounting/e-invoicing, payments, BI) is tracked separately. Phase-1
touchpoints (Twilio, and optionally plate-lookup enrichment) are folded into the
increments above; the rest are sequenced there.

## Deferred to post-MVP (with rationale)

| Item | Why deferred |
| :- | :- |
| Auto-scaling (EC2/Fargate) | 10 users / 300 customers don't need it yet; add on measured load. (P1/P2) |
| Multi-region backup replica | Single-region PITR + immutable snapshots is sufficient for MVP RPO/RTO. |
| CDN (CloudFront) | Internal staff tool, low asset volume. |
| Reporting dashboard, payments, customer portal, SMS reminders | SRS Phase 2+ scope. |

**Not deferrable (built in Increment 0–3):** TLS/HSTS/CSP/CSRF, RBAC, audit logging,
PITR + immutable backups, secret management, input validation, signed webhooks,
authenticated + rate-limited lookups.

---

## Traceability — every review finding maps to an increment

| Finding (see review) | Addressed in |
| :- | :- |
| C1 users/auth data model | Inc 0 |
| C2 spot-assignment race | Inc 2 (gate: concurrency test) |
| C3 per-tire thread depth | Inc 2 (`tires` table) |
| C4 endpoint authn/authz + enumeration | Inc 0 (RBAC) → enforced Inc 1/3 |
| C5 unsigned Twilio webhook | Inc 3 |
| C6 GDPR retention vs. erasure | Policy before Inc 4; erasure workflow Inc 4 |
| B1 RPO too loose | Inc 0 (PITR) |
| B2 immutable backups | Inc 0 (Object Lock) |
| B3 restore drill pre-go-live | Inc 0 (empty) + Inc 4 (migrated) + Inc 5 (prod-like) |
| B4 back up Excel + signatures | Inc 3 (signatures) / Inc 4 (Excel) |
| B5 migration integrity | Inc 4 |
| S1 secrets standardization | Inc 0 |
| S2 SAST/dep/secret scan in CI | Inc 0 |
| S3 session/idle timeout | Inc 0 |
| S4 Admin MFA | Decision (open); target Inc 0 or fast-follow |
| S5 audit-log integrity | Inc 0 |
| S6 phone/plate/size normalization | Inc 1 |
| S7 SMS opt-out/sender | Inc 3 |
| D1 circular FK | Inc 2 |
| D2 pricing config table | Inc 2 |
| D3 soft-delete | Inc 1 (schema) |
| D4 season structuring | Inc 1 (schema) |
| D5 list pagination/authz | Inc 1 |
| D6 API auth/error contract | Inc 0 (contract) → Inc 1 (applied) |
| P1 timeline vs. scope | Whole plan (deferrals) |
| P2 infra over-build | Decision before Inc 0 IaC |
| P3 observability | Inc 0 |
| P4 security-test stub | Inc 5 |

---

## Decisions blocking a clean start

See `requirements-review.md` §7. The two that gate Increment 0 are **hosting choice
(P2)** and **stack/ORM confirmation**; the retention/erasure policy (C6) should be
resolved before Increment 4 (migration) at the latest.
