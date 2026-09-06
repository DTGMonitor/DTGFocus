# Client Onboarding

Turns the onboarding checklist DTG already runs by email into state the dashboard
owns, and moves company logos out of `public/logo` and into Supabase Storage so a
new client can be onboarded without a deploy.

## The checklist

Lifted verbatim from the onboarding correspondence:

| # | Step | What it means |
|---|------|---------------|
| 1 | Administration | Limitations documents acknowledged, proposed TARP reviewed, TARP contacts supplied, quotation signed |
| 2 | Remote Connection Test | Preconfigured remote-access licence installed on the monitoring workstation; connection and latency verified |
| 3 | Communication Trial | A trial call to every TARP phone contact, day shift and night shift |
| 4 | Email Trial | A test notification to every address on the distribution list |
| 5 | System Readiness | Radar, wall folder, DQP parameters, alarm regions and the active TARP document all configured |
| 6 | Live Commencement | The notice that the formal monitoring service has started |

## Grain: the site, not the radar

`client_onboardings.site_id` is unique. The acknowledgement, the contacts and the
connection are agreed once with a client; a second radar dropped onto a live site
inherits them rather than repeating them.

## The tab gate

`SensorDetail` shows ONLY the Onboarding tab until `isOnboardingComplete` is true,
which needs **both**:

* every one of the six steps marked `done`, and
* `client_onboardings.commenced_at` set.

The two are not the same fact — an engineer can tick the last box without the
notice going out — so the commencement stamp is what finally opens Deformation,
Alarm, Data Quality, Downtime and TARP.

Two deliberate escape hatches keep the gate from locking anyone out:

* A site with **no** onboarding row reads as complete. Migration 001 backfills
  every site that already has a radar, so a missing row means a failed read, and
  hiding a live radar's Deformation tab over that is the worse failure.
* The tab strip is not rendered until the onboarding read resolves, so an
  unfinished site never flashes five tabs before collapsing to one.

Only the LAST step is order-enforced. Sites genuinely run the connection test
while the paperwork is still with their legal team, so steps 1–5 are advisory;
`canStartStep` refuses only `live_commencement`.

## Contact trials

Steps 3 and 4 record a verdict per contact rather than one tick, in
`onboarding_contact_tests`. Contacts are copied in from the site's **active** TARP
document, and the phone number or address actually dialled is snapshotted onto the
row — a later TARP revision must not rewrite the history of what was tested.

`summariseTrial` decides whether the escalation path holds up: two reachable phone
levels (or however many contacts exist, if fewer), one confirmed email address.
The trial's email draft prints the reachable and unreachable lists separately,
because the second list is the one the site has to act on.

## Emails

Nothing is sent. Every step generates a subject and body in
`config/onboardingEmails.ts` and hands them to Outlook via `openOutlookDraft` —
the same contract every other draft in this app keeps. The step is written to the
database FIRST, so a draft never quotes figures the dashboard has no record of.

Each draft reprints the running checklist with its ticks, which is what tells a
client three weeks in why they are being emailed again and what is left.

English and Bahasa Indonesia. The language is resolved by `resolveEmailLocale`
in `config/emailLocale.ts` — the same resolution the deformation and downtime
drafts use, so a site never receives its alarms in one language and its
onboarding in another. Subject brackets (`translateBracket`) and the
commencement timestamp (`formatEmailTimestamp`) are reused from that module too.

The onboarding sentences themselves live in `config/onboardingEmails.ts` rather
than in `EmailStrings`: they are whole paragraphs and numbered asks particular
to this flow, not the field labels that dictionary is built from. The two rules
still hold — prose translates, product and process names (TARP, alarm mask, wall
folder, TeamViewer Tensor, PO) do not.

The Onboarding **tab** stays in English in both cases. It is a DTG-internal
console; only what reaches the client is translated.

The commencement moment is entered on the SITE's clock and stored through
`toUTC`, matching every other datetime field in the sensor panel. The draft
quotes the naive value so `formatEmailTimestamp` stamps the site's zone label
("01/08/2026 06:00 WITA") rather than re-projecting it out of the analyst's
browser zone.

## Logos

`clients.logo_path` (a repo-relative path into `public/logo`) is joined by
`logo_full_path` and `logo_mark_path`, which hold object paths in the public
`CompanyLogo` bucket. `utils/companyLogos.ts` resolves storage first and falls
back to the legacy asset, so every existing client renders exactly as before until
someone uploads a replacement — no image backfill, no broken mastheads.

URL building is synchronous: report mastheads render inline, and a public bucket's
URL is a pure function of its object path.

A replacement uploads to a NEW object path rather than overwriting, because the
CDN in front of a public bucket would keep serving the previous bytes.

Logos are uploaded from `AddSensorModal` (new site) and `SiteDetailsModal`
(reached from the sensor's wrench menu and from the Onboarding tab).

## Files

| File | Role |
|------|------|
| `migrations/001_onboarding_schema.sql` | Tables, logo columns, bucket, policies, backfill |
| `config/onboarding.ts` | Step definitions and the pure progress rules |
| `config/onboardingEmails.ts` | The draft each step sends |
| `utils/companyLogos.ts` | Logo resolution and upload |
| `components/admin/Radar/Onboarding/useOnboarding.ts` | Data access; `ensureOnboarding` |
| `components/admin/Radar/Onboarding/OnboardingTab.jsx` | The flow |
| `components/admin/Radar/Onboarding/ContactTrialPanel.jsx` | Per-contact verdicts |
| `components/admin/Radar/Onboarding/SiteDetailsModal.jsx` | Site, company and logo editor |
| `components/admin/Radar/Tabs/Tab_Container.jsx` | `visibleTabs` — the gate |

Tests: `__tests__/client-onboarding.test.ts`, `__tests__/company-logos.test.ts`,
`__tests__/onboarding-tab-gate.test.jsx`.
