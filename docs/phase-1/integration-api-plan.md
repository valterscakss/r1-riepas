# R1 Tires — Integration & API Plan (connecting to other systems)

**Companion to:** `build-plan.md`, `requirements-review.md`
**Purpose:** Plan how R1 Tires exchanges data with external systems — both the
**inbound** APIs we consume and the **outbound** API/events we expose so other
systems can connect to us. The SRS only specifies Twilio (and email as Phase 2);
this document plans the wider integration surface.

**Severity/priority:** ⭐ MVP (Phase 1) · ➕ Fast-follow · 🔭 Later

---

## 1. Integration principles (apply to every integration)

- **Versioned API:** all endpoints under `/api/v1`; breaking changes → `/api/v2`.
- **Two auth models:**
  - *Interactive (staff UI):* session + CSRF (from the security baseline).
  - *Machine-to-machine (other systems):* API keys or OAuth2 client-credentials,
    scoped per integration, rotatable, stored in Secrets Manager.
- **Least privilege:** each integration key is scoped to only the resources it needs.
- **Idempotency:** all state-changing external calls carry an idempotency key.
- **Resilience:** timeouts, bounded retries with backoff, circuit-breaking; every
  integration has a manual fallback (matches the SMS fallback posture in SRS §9.1).
- **Signed webhooks:** inbound webhooks validate a signature (e.g. Twilio's
  `X-Twilio-Signature`); outbound webhooks are signed with an HMAC secret.
- **Observability:** per-integration success rate, latency, and error alerts.
- **Contract-first:** every integration is described in the OpenAPI spec before code;
  no undocumented endpoints (enforced in CI — see build plan documentation gate).
- **Data protection:** only the minimum PII crosses a boundary; DPAs in place with
  each processor (GDPR, SRS §12.7).

---

## 2. Inbound — external systems we consume

| System | Purpose | Priority | Notes |
| :- | :- | :- | :- |
| **Twilio (SMS)** | Send intake/retrieval codes; receive delivery status | ⭐ MVP | Already in SRS §9.1. Add signed webhook (finding C5), opt-out/STOP, registered sender for LV (finding S7). |
| **Vehicle registry (CSDD, Latvia)** | Plate → make/model/year to enrich intake auto-fill | ➕ Fast-follow | Strong UX win for FR-2.2.1/2. Confirm API availability, licensing, and GDPR basis before committing. Fallback: manual entry. |
| **Email (Resend / SES)** | Confirmations, reminders | 🔭 Later | SRS Phase 2 (§9.2). EU region for SES. |
| **Payment provider (Stripe)** | Charge/track storage fees | 🔭 Later | SRS Phase 2. Use Stripe-hosted flows; never store card data. |

---

## 3. Outbound — our API/events for other systems to connect to

### 3.1 Public/partner REST API (machine clients)
A read-mostly, API-key-scoped subset of `/api/v1` so other systems (BI, accounting,
a future customer portal) can pull data without screen-scraping. Rate-limited and
paginated. Example resources: customers, tire_sets, locations (read); intake/retrieval
remain staff-authenticated for MVP.

### 3.2 Outbound webhooks (event push)
Let external systems subscribe to domain events instead of polling. Signed (HMAC),
retried with backoff, delivered at-least-once with idempotency keys.

| Event | Fired when | Typical consumer |
| :- | :- | :- |
| `intake.created` | Tire set stored | Accounting (raise invoice), BI |
| `retrieval.completed` | Tires released | Accounting (close), BI, CRM |
| `sms.delivery_failed` | SMS failed 3× | Ops alerting |
| `capacity.threshold_reached` | 75/90/100% full (FR-2.4.3) | Ops/BI |

### 3.3 Data export
Scheduled, encrypted export (CSV/JSON to a bucket) for BI/accounting until a live
integration exists — the pragmatic bridge for Phase 1.

---

## 4. Candidate business integrations (planned, sequenced)

| Integration | Value | Priority | Direction |
| :- | :- | :- | :- |
| **Accounting / invoicing** (e.g. LV accounting SW) | Turn storage fees into invoices automatically | ➕ Fast-follow | Outbound (webhook/export) |
| **EU e-invoicing / PEPPOL** | Mandatory structured e-invoices for company customers (have `tax_id`) | 🔭 Later | Outbound |
| **Vehicle registry (CSDD)** | Auto-fill vehicle data from plate | ➕ Fast-follow | Inbound |
| **BI / analytics** | Dashboards, revenue, utilization (SRS Phase 2) | 🔭 Later | Export / read API |
| **CRM / marketing** | Customer lifecycle, seasonal outreach | 🔭 Later | Outbound |
| **Customer portal / mobile** (SRS Phase 2) | Self-service retrieval status | 🔭 Later | Consumes public API |

---

## 5. Where this lands in the build

- **Phase 1 (MVP):** Twilio only, hardened (Increment 3). Design the API/event
  contract and OpenAPI spec so nothing later requires breaking changes. Optionally
  add plate-lookup enrichment if the registry API is readily available.
- **Fast-follow:** vehicle registry enrichment; accounting via `intake.created` /
  `retrieval.completed` webhooks or scheduled export.
- **Later (Phase 2+):** payments, email automation, PEPPOL e-invoicing, BI, CRM,
  customer portal — all consuming the versioned API and signed webhooks defined now.

---

## 6. Decisions needed

1. **Vehicle registry:** is a CSDD (or third-party) plate-lookup API available to us,
   at what cost, and with what GDPR basis? Gates the fast-follow enrichment.
2. **Accounting target:** which system, and do we push (webhook/API) or export?
3. **Machine auth:** API keys (simpler) vs. OAuth2 client-credentials (stronger) for
   partner access — pick per the first real consumer.
