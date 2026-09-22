# DECISIONS.md — Decision Log

A chronological log of engineering decisions that shaped the project but are smaller than
an ADR. Formal architecture decisions live in `docs/adr/`.

**Why this file exists:** an architectural assumption that exists only in a chat log does
not exist. The repository is the source of truth.

**Format:** date · decision · why · alternatives · consequence.
Newest entries at the top. Entries are never deleted; a reversed decision gets a new entry
referencing the old one.

---

## 2026-09-22 — Fleet rollups

### D-090 · The demo garage carries MOT, insurance and tax
`seedObligations` gives each demo vehicle a current MOT, a policy and a tax period — plus
one expired MOT from the year before, and a tax date inside the 30-day window on one
vehicle. **Why:** without them the fleet table can only say "nothing recorded" against
every row, the reminder engine has nothing to fire on, and three shipped features are
invisible to anyone evaluating the product. The deliberately imperfect data matters as
much as the good data: a compliance view that is entirely green demonstrates nothing about
what it does when something is due, and the superseded MOT is what proves the fleet report
reads the *current* expiry rather than the oldest row on file. Same idempotent-pass shape
as [D-087], for the same reason.

### D-089 · A cost that belongs to no vehicle is never spread across the fleet
Workspace-level expenses are reported in their own `unassigned` column and excluded from
every per-vehicle figure. **Why:** apportioning them would require a rule — equally? by
mileage? by spend? — and every one of those rules is invented. Worse, the choice would
quietly change every vehicle's cost per mile, which is the number the table exists to make
comparable. **Consequence:** the per-vehicle totals do not sum to the fleet total whenever
unassigned costs exist, so the UI states the difference explicitly instead of letting a
reader discover it by adding the column up.

### D-088 · Compliance is read from the records, and UNKNOWN is not OK
The fleet report builds each vehicle's compliance from the latest `vehicle_inspections`,
`insurance_policies` and `road_tax_records` row of each kind, not from `reminders`.
**Why reminders are the wrong source:** a reminder can be dismissed, snoozed, cancelled by
a status change (D-083) or simply not generated yet, and none of those things renews an
MOT. The obligation records are the fact; reminders are a notification about it.
**Why the latest row per kind:** a van with five years of MOT history has five expiry
dates, four of them long past, and taking the soonest of all of them would report every
well-maintained vehicle as expired. **Why `UNKNOWN` is a distinct state:** a vehicle with
nothing recorded must never render as a green tick. It means nobody has told us, which is
a thing a fleet manager needs to chase, not tick off. The 30-day `DUE_SOON` window matches
the reminder engine's lead time deliberately, so the table and the email never disagree.

---

## 2026-09-22 — Fuel economy trends

### D-087 · The demo workspace carries a real fill history
`seedFuelHistory` gives each demo vehicle a year of full fills, with matching expense rows,
in its own idempotent pass rather than inside vehicle creation. **Why:** the seed skips
vehicles that already exist, so a workspace seeded before fuel tracking shipped would never
have acquired any — fuel tracking and the consumption trend were both invisible in the demo
data, which is the same as not having shipped them for anyone evaluating the product.
**Consequence, and a correction worth keeping:** the first version spaced fills a fixed
fortnight apart and put 136 litres into a car with a 62-litre tank. The gap is now derived
from how hard the vehicle is actually driven, targeting ~45 litres a fill. Demo data that
is impossible teaches the viewer to distrust every other number on the page, so it is worth
the extra arithmetic.

### D-086 · A seasonal effect is disclosed, not corrected out
Under twelve months of history, a direction carries a `SEASONAL_OVERLAP` caution.
**Why:** winter economy is materially worse than summer economy in a perfectly healthy car
— cold starts, richer running, winter blends, heating load. Comparing November against
August therefore measures the weather. **Alternatives considered:** (a) suppress the
direction until a year of data exists — rejected, because a car that genuinely deteriorated
over six months is exactly when the user wants to know; (b) apply a seasonal adjustment —
rejected, because the correction would have to be invented from no data about this
vehicle's climate or usage, and a fabricated adjustment is worse than a stated caveat.
**Consequence:** the caution disappears on its own at twelve months.

### D-085 · The trend compares consumption, never miles per gallon
Direction is computed from litres (or kWh) per 100 km. **Why:** mpg rises as a car
improves while L/100km falls. A verdict computed from mpg with the comparison written for
consumption would report an improving car as worsening — and this is the one error in this
engine a user would *act* on, by booking a service the car does not need. Consumption also
has the property that higher is always worse, whatever the energy source, which is what
makes one comparison work for both petrol and electric. A test asserts that mpg and the
direction move in opposite directions, so the invariant fails loudly if the measure is ever
swapped.

### D-084 · Six months of data, three-month windows, and a five-percent band
`computeFuelTrend` needs six measured months before it will state a direction. It compares
the most recent three months against the three before, weighting each month by distance,
and calls anything inside ±5% stable. **Why each number:** consecutive tanks in the same
car routinely differ by more than 5%, so a narrower band would report noise as
deterioration; three-month windows average out a single bad tank; six months is the minimum
that gives two of them. Distance weighting matters more than it looks — a month containing
one 20 km trip must not weigh as heavily as a month of commuting, and an unweighted mean of
monthly figures turns that short trip into a false alarm. **Consequence:** a new user sees
monthly bars from the second full tank but no verdict for six months, and the UI says which
it is and why rather than showing an empty box.

---

## 2026-09-22 — Document pen test and vehicle lifecycle

### D-083 · Leaving `ACTIVE` cancels the vehicle's open reminders
`changeStatus` cancels every `DUE`/`UPCOMING` reminder on a vehicle that moves to `SOLD`,
`SCRAPPED` or `ARCHIVED`. **Why:** a reminder is a claim on the user's attention, and the
MOT of a car sold three months ago is not one. Left alone, the notification engine would
keep emailing about a vehicle the user no longer owns, which is the fastest way to teach
somebody to ignore this product's email. **Alternative considered:** filtering inactive
vehicles out at send time. Rejected — the same filter would then have to be repeated in
the digest, the dashboard and the reminder list, and a miss in any one of them sends the
email. Cancelling once at the transition puts the rule in a single place.
**Consequence:** returning a vehicle to `ACTIVE` does not resurrect the cancelled
reminders; the scheduler regenerates them from the inspection and policy dates on its next
run, which is the same path that created them originally.

### D-082 · A vehicle is never hard-deleted by a user action
`DELETE /vehicles/:id` sets `deleted_at` and returns 204. The row, its services, fills,
odometer history, inspections and documents all stay exactly where they were, and
`GET /vehicles/deleted` plus `POST /vehicles/:id/restore` bring it back whole. **Why:**
this product's entire proposition is that it remembers what happened to a car. A confirm
dialog is not adequate protection for eleven years of service history against one
mis-aimed click, and the person who deletes a vehicle by mistake is precisely the person
who most needs the history back. **Alternative considered:** a hard delete behind a typed
confirmation. Rejected for user data; it remains the right shape for the workspace-level
erasure that GDPR requires, which is a different operation with a different blast radius
(`GDPR-002`). **Consequence:** every read path must exclude soft-deleted vehicles
explicitly — reports, the expense list and the dashboard now filter on
`vehicle: { deletedAt: null }`, and any new aggregate over vehicles must do the same.

The registration uniqueness index is partial (`WHERE deleted_at IS NULL`), so a deleted
vehicle releases its plate — correct, because the commonest reason to delete one is that
it was entered wrongly and is about to be entered again properly. The cost is a collision
that only exists because deletion is reversible: reuse the plate, then restore the
original, and two live rows would share one registration. Postgres refuses, and before
this was handled the user got a 500 from a button labelled Restore. `restore()` now checks
first and returns `409 REGISTRATION_REUSED` naming what happened, with the vehicle left
deleted rather than half-restored. **Found by testing the interaction, not by reading the
code** — each half is obviously right on its own, which is exactly why the pair was not
noticed.

### D-081 · Filenames are encoded per RFC 6266, and bidi controls are stripped
`contentDisposition()` emits both `filename=` (ASCII-folded) and `filename*=UTF-8''…`
(percent-encoded), and `sanitiseFilename()` removes U+202A–U+202E and U+2066–U+2069.
**Why:** the pen test found a real, if low-severity, defect — a non-ASCII filename went
into a header that is latin-1 by definition, so `Ремонт.pdf` reached the browser as
mojibake and some clients dropped the download. The bidi strip addresses the related
trick: `invoice‮gnp.exe` renders as `invoiceexe.png` in a file manager while
remaining an executable. Neither is a breach, and both are the kind of thing a user
experiences as "this app corrupted my file". **Alternative considered:** rejecting
non-ASCII filenames at upload. Rejected — it would refuse legitimate Romanian, Cyrillic
and Greek filenames, which is worse than encoding them correctly.
**Consequence:** six tests in `packages/storage/src/policy.test.ts` pin the encoding, the
folding and the control-character strip.

### D-080 · The document pipeline was attacked before it was declared safe
`scripts/pentest-documents.mjs` runs 21 adversarial requests against the running stack in
eight groups: cross-tenant object access, presigned-URL tampering, path traversal in
object keys, content-type confusion, filename injection into headers, permission bypass on
private documents, URL expiry and replay, and enumeration of object keys. All 21 are
refused; the single genuine finding was the filename encoding fixed in [D-081].
**Why this is written down:** `HARD-003` is a CRITICAL task whose deliverable is evidence,
and "I reviewed the code and it looks fine" is not evidence. The script is committed so
the same 21 attacks re-run against every future change to the pipeline.
**A caution recorded deliberately:** one run reported a CRITICAL "presigned GET can be
repointed at another tenant's object". It was false — the test substituted a string that
does not occur in the URL, so it fetched the original valid URL and read 200 as a breach.
The check now mutates the actual object path and fails loudly if its own substitution was
a no-op. A security script that cannot detect its own vacuous assertions produces
confident nonsense in both directions.

---

## 2026-09-22 — Cost reports

### D-079 · A failing check in a verification script must fail the script
The scripts used `ok(cond ? 'good' : 'BAD')`, which printed a tick beside the failure text
and left the exit code at zero. **Why this is a decision and not a typo:** 38 such checks
existed across 12 scripts, so every "Errors: none" those scripts reported was weaker than
it looked — a broken expectation was indistinguishable from a met one unless somebody read
the output closely. They now call `check(condition, good, bad)`, which prints a cross,
records the failure and sets the exit code. **Consequence:** ten of the converted checks
had the failure text on the *true* branch and had to be inverted; the mobile-overflow
checks were all of this shape. Nothing genuine was hidden — the sweep found two console
errors that turned out to be deliberately provoked — but that was luck, not design.

### D-078 · A period under 90 days is never annualised
`costPerYear` returns null with `PERIOD_TOO_SHORT` rather than extrapolating. **Why:**
vehicle costs are lumpy. One service or one insurance renewal inside a six-week window
projects to a wildly overstated year, and the figure looks authoritative precisely because
it is precise. **Alternatives:** annualising with a caveat, which nobody reads; or picking
a shorter threshold, which only moves the line. **Consequence:** a full year is reported
as measured, a period between 90 days and a year is flagged `projected: true`, and the UI
says "at this rate" rather than stating it as fact.

### D-077 · Distance is summed per vehicle, never across them
The report measures each vehicle's own odometer span and adds those, rather than taking
max minus min over all readings. **Why:** two vehicles' odometers are unrelated numbers.
A workspace with a car at 12,000 km and another at 93,000 would otherwise report 81,000 km
of travel that nobody drove. **Consequence:** a vehicle with a single reading in the period
contributes nothing rather than corrupting the total, and odometer *corrections* are
excluded entirely — a correction restates a past reading rather than recording travel, so
counting it would invent distance.

## 2026-09-22 — Fuel and consumption

### D-076 · A fill is also a mileage reading
Recording a fill writes an `odometer_entries` row with `source = FUEL`, exactly as a
service does. **Why:** filling up is the most frequent moment anyone notes their mileage,
and asking for it twice would guarantee the two disagree. It also keeps distance-based
maintenance accurate for people who never open the mileage tab.
**Consequence:** a fill participates in odometer regression checks, so a typo in the
mileage is caught at the pump rather than corrupting every economy figure after it.

### D-075 · Litres and kWh are never added together
An interval containing both liquid fuel and charging is excluded, with the reason
`MIXED_ENERGY`. **Why:** a plug-in hybrid charged and fuelled between two full tanks
consumed two different physical quantities. Adding them is meaningless; picking one
understates the other; converting kWh to a "litre equivalent" invents an efficiency
factor the platform has no basis for. **Alternatives:** reporting two separate figures for
the same interval, which is defensible and needs a UI that can express it — worth doing
when plug-in hybrids are a real user group. **Consequence:** PHEV owners who both charge
and fuel will see intervals excluded, and the panel names the reason rather than silently
dropping them.

### D-074 · The average is weighted by distance, not by interval
Total fuel over total distance, not the mean of the per-interval figures. **Why:** a
100 km interval and a 900 km one are not equally informative about how the vehicle
behaves, and averaging the figures lets one short motorway run distort a year of driving.
The test asserts a case where the two methods differ by four litres per hundred.
**Consequence:** the panel reports the distance and quantity behind the number, so the
figure can be checked rather than believed.

## 2026-09-22 — Membership, roles and invitations

### D-073 · An invitation is bound to the address it was sent to
Accepting requires a session whose email matches the invitation's. **Why:** otherwise
forwarding the email is an access grant to whoever opens it first, and the audit trail
records the wrong person joining. **Alternatives:** binding to the token alone is simpler
and makes a forwarded invitation indistinguishable from an intended one.
**Consequence:** someone invited at an address they do not use must sign in with it, and
the API says so by name rather than refusing blankly.

### D-072 · A spent invitation is refused exactly like a forged one
Accepted, revoked, expired and never-existed tokens all return `TOKEN_INVALID`.
**Why:** distinguishing them tells a prober which tokens were once real. The first draft
returned a distinct error for a replay, which a test caught. **Alternatives:** a friendlier
"already accepted" message, at the cost of a small oracle. **Consequence:** a user who
clicks an old link twice gets a generic message; the UI compensates by explaining the
likely causes on the landing page.

### D-071 · Ownership transfer demotes before it promotes
The transaction sets the current owner to ADMIN first, then promotes the new one.
**Why:** a partial unique index permits exactly one ACTIVE OWNER per workspace, so
promoting first violates it and aborts. Demoting first keeps the invariant true at every
intermediate state, and makes a concurrent double transfer safe for free: the second
transaction finds no OWNER row to demote and is refused with a conflict rather than
corrupting the workspace. **Alternatives:** dropping the index and enforcing it in code,
which is exactly the kind of invariant application code loses under concurrency.
**Consequence:** the order of two statements is load-bearing and is commented as such;
the integration suite fires two transfers at once and asserts one owner survives.

## 2026-09-21 — Support access

### D-070 · A grant opens document *metadata*, never document contents
Staff behind a `DOCUMENTS` grant see filename, type, size and status. There is no admin
download endpoint at all. **Why:** the support question is almost always "did their upload
work?", which metadata answers. Reading the file is a different act with a different risk,
and building the endpoint "just in case" would mean the restriction rests on nobody having
called it yet. **Alternatives:** a second, narrower scope for contents — worth adding when
a real case needs it, and not before. **Consequence:** a support case that genuinely
requires the file contents currently has no path, and should be handled by asking the
customer. Recorded here so the gap is a decision rather than an oversight.

### D-069 · The register is readable by roles that cannot request access
`admin:support_access:read` is held by every role including `READ_ONLY`; only `SUPPORT`
and `SUPER_ADMIN` can request. **Why:** a register only the people using it can read is
not oversight. Making it visible to the roles least able to abuse it is what turns it into
a check. **Alternatives:** restricting it to SUPER_ADMIN, which makes the audit trail a
thing one person reviews rather than a thing colleagues notice. **Consequence:** the
reason text is shown in full in the console, so it is written for colleagues to read.

### D-068 · Every *use* of a grant is audited, not only the granting
`assertAccess` writes an audit row on each request it permits, and one on each it refuses,
and increments a use counter on the grant. **Why:** a grant recorded once and then used
silently for a day is indistinguishable from unrestricted access for that day. The
requirement in `SECURITY.md` §15 is "every support access grant **and use**", and the use
half is the part that is easy to skip. The refusals are recorded too, because an attempt
without a grant is at least as interesting as a successful read. **Alternatives:** logging
only the grant is cheaper and answers none of the questions an incident asks.
**Consequence:** the audit table grows per request rather than per grant, and the grant
carries `use_count`/`last_used_at` so "was this actually needed?" is answerable at a
glance.

## 2026-09-21 — Admin authentication realm

### D-067 · First successful sign-in completes 2FA enrolment
An account created with a provisioned secret is `PENDING_MFA`; presenting the password and
a valid code activates it. **Why:** the first design required an explicit confirmation
step, which deadlocked — confirming needed an admin session, and a session needed a
completed enrolment, so a freshly created account could never be used. Caught by looking
at the database after creating a real account rather than by review. The operator already
holds the secret from `create-admin.mjs` and has just proved it by producing a valid code,
so a separate step added ceremony, not security. **Alternatives:** creating accounts
`ACTIVE` outright, which makes the `PENDING_MFA` state and its audit event meaningless.
**Consequence:** both factors are still mandatory to reach the activation path, an account
with no secret at all remains unusable, and enrolment is recorded as its own audit event.

### D-066 · An admin route with no declared permission is refused, not served
The admin guard requires `@RequireAdmin(...)`; a route without one returns 404 even to a
valid admin session. **Why:** the failure mode of "default allow" is a new endpoint that
is silently world-readable to every staff role the day it is written. Defaulting closed
turns that mistake into a visible 404 during development instead of an invisible hole in
production. **Alternatives:** a CI check that enumerates routes catches it later and only
if someone maintains the check. **Consequence:** adding an admin endpoint is two lines,
and forgetting the second one is loud.

### D-065 · The admin surface answers 404, never 401
An unauthenticated request to `/api/v1/admin/*` is indistinguishable from a route that
does not exist. **Why:** the console is not a product feature to advertise. A 401 confirms
there is an administrative surface at that address and invites a closer look; a 404 tells
a prober nothing. Customers already get this treatment across tenants (404-over-403), so
the behaviour is consistent. **Alternatives:** 401 is friendlier to a staff member who let
their session lapse — handled instead in the console, which reads a 404 as "sign in
again". **Consequence:** the admin app cannot distinguish "logged out" from "route gone",
and does not need to.

### D-064 · The TOTP secret is encrypted, not hashed — unlike every other credential
`admin_users.mfa_secret` holds AES-256-GCM ciphertext under a key derived from
`SESSION_SECRET` by HKDF. **Why:** `DATABASE.md` §4.12 called the column `mfa_secret_hash`,
but a hash cannot verify a rotating code — TOTP requires the original bytes. Pretending
otherwise would have meant either storing it in the clear under a misleading name, or
building something that could not work. Everything else in the platform (passwords,
session tokens, reset tokens) is still hashed, because those only ever need comparing.
**Alternatives:** a dedicated KMS is the production answer and is not available locally;
HKDF from the existing secret keeps the key out of the database without inventing
infrastructure. **Consequence:** the column is renamed `mfa_secret`, rotation of
`SESSION_SECRET` invalidates every enrolment, and the ciphertext is authenticated so
tampering fails loudly rather than yielding a plausible wrong secret.

### D-063 · TOTP is implemented here rather than taken as a dependency
RFC 6238 over RFC 4226, on node's crypto, about sixty lines. **Why:** this is the second
factor protecting every administrative action, the RFC publishes test vectors that prove
an implementation correct, and the alternative is trusting an unaudited package in the
hottest part of the security boundary. The six published vectors are asserted directly.
**Alternatives:** `otplib` or `speakeasy` — more code in the dependency tree, no better
verified. **Consequence:** the verification window is one step either side and that is a
deliberate, tested choice rather than a library default.

## 2026-09-21 — Document vault

### D-062 · `scan_status` is `SKIPPED`, never a fictitious `CLEAN`
No malware scanner is configured, so a verified upload is recorded as `SKIPPED`.
**Why:** `CLEAN` is a claim that a file was examined and found safe. Writing it when
nothing examined the file would be a lie encoded in the data, and one that a future
operator would reasonably trust. **Alternatives:** defaulting to `CLEAN` reads better and
is false. **Consequence:** the column already distinguishes "not scanned" from "scanned
and clean", so integrating a scanner later is a behaviour change, not a migration.

### D-061 · A file that is not what it claimed is quarantined, not rejected
Finalisation checks size, magic bytes and SHA-256; a mismatch sets `QUARANTINED` rather
than deleting the row. **Why:** an upload whose bytes disagree with its declared type is
the attack this step exists to catch, and throwing the evidence away makes it
uninvestigable. The object stays unreachable either way. **Alternatives:** deleting
immediately loses the incident; accepting it and scanning later serves the file in the
meantime. **Consequence:** `QUARANTINED` rows are excluded from listings and downloads by
status, not by filtering at the call site, so a new endpoint cannot forget.

### D-060 · Files never pass through the API
The client receives a presigned PUT and uploads directly to object storage; downloads are
presigned GETs valid for five minutes. **Why:** streaming 20 MB files through the API
makes it memory-hungry and slow for everyone else, and the API's real job here is the
decision — who may upload, what may be uploaded, who may be handed a URL — not the
transfer. **Alternatives:** proxying gives a single choke point for scanning, at the cost
of making every upload an API outage risk. **Consequence:** validation happens twice, at
session creation (declared) and at finalisation (actual), because the bytes arrive
somewhere we do not control.

### D-059 · The object key never contains the original filename
Keys are `workspaces/{workspaceId}/{yyyy}/{mm}/{uuidv7}{ext}`; the filename is metadata
and is restored only in a `Content-Disposition` header. **Why:** the filename is
attacker-controlled and would carry path separators, encoding tricks and unicode
confusables into the object store. The key is also the only address of the object, so it
must be unguessable — possession of one tells you nothing about any other.
**Alternatives:** sanitising the filename into the key is a blocklist, and blocklists
lose. **Consequence:** the key is never returned by the API, and the filename is stripped
of header-injection characters before it reaches a response.

## 2026-09-21 — Expense ledger and dashboard honesty

### D-058 · `expenses` is the single cost surface, enforced by a unique key
Every cost — entered or projected — is a row in `expenses`, and `(source_type,
source_record_id)` is unique. **Why:** DATABASE.md §4.8 requires that a service is never
counted both directly and through its projection. A convention would drift; a unique index
makes a second projection of the same service impossible, so re-saving an edited service
updates the row it already owns. **Alternatives:** computing costs by unioning service
records, fuel and manual rows at read time, which makes every report a bespoke query and
every new cost source a change to all of them. **Consequence:** source records must push
into the ledger on create, update and delete, and a failed projection is logged without
failing the user's write — the service record is the real data, the expense row a
convenience.

## 2026-09-21 — Ownership modules (inspection, insurance, road tax)

### D-057 · The dashboard reports what is in the database, not what was true in Phase 2
`servicesDue`, `overdue`, attention items and month-to-date spend are now derived from
maintenance rules, ownership expiries and the expense ledger. **Why:** the payload still
carried hardcoded zeros behind a comment saying maintenance and expiry tracking "arrive in
Phases 4 and 6" — both had shipped, so a vehicle with an expired MOT showed nothing at all
on the first screen the user sees, and the brief is explicit that mocked totals must go
once real data exists. **Alternatives:** leaving it until a reporting phase, which means
shipping a dashboard that under-reports reality. **Consequence:** the dashboard now reads
five tables instead of two, and the "current record only" rule from D-051 had to be
repeated there so the panel and the reminders cannot disagree.

### D-056 · A blank amount is "not recorded", never a zero cost
A service with no total, or a policy with no premium, projects nothing; clearing an amount
withdraws the projection. **Why:** £0.00 is a claim about the world — that something was
free — and the user would reasonably believe it. Absence of a figure is not a figure.
**Alternatives:** projecting zero keeps the code simpler and every total a lie by exactly
the amount nobody recorded. **Consequence:** `amountOf()` maps both null and zero to "no
projection", so a genuinely free service cannot be represented; if that ever matters it
needs an explicit flag rather than a magic number.

### D-055 · Projected expenses are read-only through the expense API
Rows with a `sourceType` other than `MANUAL` refuse edit and delete, with a message naming
the record to edit instead. **Why:** they are derived data. Letting someone change the
amount would produce a figure that silently reverts the next time the source record was
touched — worse than refusing, because the user would believe the edit held.
**Alternatives:** allowing the edit and abandoning the projection for that row, which
makes the ledger's provenance unknowable. **Consequence:** the API needs a specific error
rather than a generic 403, and the UI hides the affordance instead of showing one that
fails.

### D-054 · Money in different currencies is never summed
Totals report `mixedCurrencies: true` and a null figure rather than adding amounts across
currencies. **Why:** the platform holds no exchange rates, and no date to apply them on; a
single number would be a fiction presented with full confidence. **Alternatives:** summing
the raw numbers, which is simply wrong; picking the workspace default and converting,
which invents a rate. **Consequence:** the dashboard tile and the expense summary both
have a "can't say" state, and the UI says so in words rather than showing a dash alone.

### D-053 · Expiry state is computed by the server, on a 90-day horizon
The API returns `expiryStatus` and `daysRemaining`; the reminder sources use the same
90-day horizon. **Why:** a component doing its own date arithmetic renders differently
depending on the viewer's clock and can disagree with the reminder that was emailed — the
same defect D-041 fixed for reminder bucketing. One horizon in one place also means the
Ownership tab and the reminder cannot contradict each other. **Alternatives:** returning
the raw date and letting each client decide; that is how the two ended up disagreeing
before. **Consequence:** changing the horizon is a one-line server change, and the UI
carries no date logic beyond formatting.

### D-052 · Renewing an obligation cancels the reminder for the one it replaces
Creating an inspection, policy or tax record cancels open reminders pointing at that
vehicle's earlier records of the same type. **Why:** the scan stops *emitting* a
superseded record, but a reminder already raised stays open, so a vehicle whose MOT was
renewed this morning would still show "MOT has expired". **Alternatives:** expiring
reminders on a timer, which leaves a window where the product is plainly wrong; or making
the source cancel them, which would give read-only scanners write powers.
**Consequence:** renewal is a write path that touches reminders, so the ownership service
depends on the reminder table and the behaviour is covered by its own test.

### D-051 · Only the record that currently protects the vehicle is a reminder candidate
Each expiry source takes, per vehicle, the row with the furthest-future expiry and ignores
the rest. **Why:** a vehicle with eight years of MOT history has eight expired
certificates. Emitting each would bury the owner in reminders about obligations they met
years ago and make the whole feature noise. **Alternatives:** filtering by "expired within
the last N days" still resurfaces old rows whenever N changes. **Consequence:** the
selection rule is a pure function, `latestPerVehicle`, tested independently of the
database; a record with no expiry date is not an obligation and is skipped entirely.

### D-050 · Ownership records are readable by DRIVER; their money is not
`ownership:read` is granted to every role including DRIVER, `ownership:write` is not, and
monetary fields are omitted for any role lacking `expense:read`. **Why:** driving without
a valid MOT or insurance is an offence, so hiding expiry from the person actually driving
would be a safety failure — but the existing doctrine is that a DRIVER sees no money
(ARCHITECTURE.md §5.1 note 2). Both hold at once only if visibility is split from
financial detail. **Alternatives:** a separate `ownership:money` permission duplicates
what `expense:read` already means; giving DRIVER no access at all keeps the matrix simpler
at the cost of the one user who most needs the information. **Consequence:** the response
shape varies by role, so the fields are optional in the client types and absent rather
than null — a client must not read "hidden" as "not recorded".

## 2026-09-20 — Email suppression and delivery inspection

### D-049 · The suppression list is global, not tenant-scoped
`email_suppressions` has no `workspace_id`. **Why:** a mailbox that no longer exists does
not exist for any tenant, and a spam complaint follows the address rather than the
workspace; per-tenant lists would keep mailing a dead address from every other workspace.
**Alternatives:** a workspace-scoped list respects the isolation model mechanically but
gets the domain wrong. **Consequence:** the table is deliberately absent from the tenant
client's model set — the one place where that absence is intended rather than an
oversight — so it is called out here and in `EMAILS.md` §7.

## 2026-09-20 — Shell interactions

### D-048 · Numbering correction: the shell and redesign entries are D-044 and D-043
Two entries were written as D-039 and D-038, numbers already taken by the BullMQ job-id
and reminder-scan decisions. They have been renumbered to D-044 and D-043 in place.
**Why:** a decision log where one identifier means two different things cannot be cited,
which is the only reason it exists. **Alternatives:** leaving the collision and adding a
note is cheaper but leaves every future reference ambiguous. **Consequence:** the entries
keep their content and position; nothing outside this file referenced the old numbers.

### D-047 · Releasing a suppression sets `released_at` rather than deleting the row
**Why:** why an address was once refused is exactly what someone needs when it bounces
again, and the brief forbids casually destroying history. A later bounce clears
`released_at` and re-suppresses. **Alternatives:** deleting the row loses the evidence and
lets one manual release permanently disarm the protection for that address.
**Consequence:** "is this address suppressed?" is `released_at IS NULL`, not row existence,
and every query and the unique constraint are written around that.

### D-046 · A spam complaint does not block account and security mail
`HARD_BOUNCE` and `MANUAL` block every category; `COMPLAINT` blocks everything except
`ACCOUNT` and `SECURITY`. **Why:** a hard bounce means the mailbox does not exist, so no
category can be delivered — but someone who once marked a service reminder as spam must
still be able to reset their own password. Locking a user out of account recovery is a
worse failure than honouring a complaint absolutely. **Alternatives:** blocking all mail
after a complaint, which the first draft of `EMAILS.md` §7 implied in one bullet and
contradicted in the next. **Consequence:** the policy is one pure, unit-tested function,
`suppressionBlocks(reason, category)`, and §7 now states the resolution explicitly.

### D-045 · Only a *permanent* bounce suppresses; unclassified bounces do not
Transient and unclassified bounces are recorded as events but never suppress.
**Why:** suppressing an address silently ends that owner's MOT, insurance and service
reminders — deadlines with legal and financial consequences. A full mailbox or a
greylisting blip clears by itself, so the cost of one wasted send is far lower than the
cost of a false suppression. **Alternatives:** treating any bounce as permanent maximises
sender reputation at users' expense. **Consequence:** the planned "three soft bounces in
30 days" escalation is explicitly not built, and `EMAILS.md` §7 says so rather than
implying the rule is active.

### D-044 · Native selection and existing dialogs for shell controls
Use a labelled native select for workspaces and extend the shared Dialog with a drawer
size. **Why:** consistent browser keyboard behaviour without a second overlay system.
**Alternatives:** a custom ARIA menu requires additional focus and arrow-key machinery;
a new component dependency duplicates existing modal behaviour. **Consequence:** account
controls are a small dialog; localStorage is optional persistence, never the source of
reactivity. Role-aware entry points use the existing permissions package. UI-004 isolates
this frontend slice from UI-002's unfinished membership-mutation dependency WS-002.

## 2026-09-20 — Dashboard redesign

### D-043 · Redesign the functioning dashboard first
**Decision:** deliver UI-003 as a presentation-focused task over the existing shell,
overview and vehicle cards, using the existing semantic tokens and components.
**Why:** the user prioritised redesign; these screens already expose real vehicle and
maintenance data. **Alternatives:** redesign all three frontends simultaneously, or
finish the reminder engine first. Both would dilute the first reviewable UI change.
**Consequence:** marketing, admin, API contracts, permissions and database schema retain
their current behaviour. UI-002 and WS-002 remain separate unfinished tasks; UI-003 does
not claim a complete accessibility or security audit. New overview text uses a small
English catalogue; existing hardcoded text elsewhere needs a separate migration.

## 2026-09-20 — Phase 1

### D-042 · Reminder windows expose both a phrase and a bare magnitude
`WindowDecision` returns `phrase` ("3 days ago", "in 7 days") and `magnitude` ("3 days").
**Why:** reusing `phrase` after a caller's own preposition shipped a real notification
reading "Overdue by 23,200 miles ago." **Consequence:** callers that supply a preposition
use `magnitude`; a regression test asserts the magnitude never contains "ago" or "in".

### D-041 · Reminder bucketing is computed by the server
The reminders API returns `bucket` (OVERDUE / DUE_SOON / UPCOMING / HANDLED) and
`daysRemaining`. **Why:** the first version grouped by comparing dates in the React
render, which the `react-hooks` lint rule correctly flagged as an impure render — and it
duplicated a business rule the API already owns. **Consequence:** the UI groups by a
field; changing the "due soon" horizon is a server change, not a client one.

### D-040 · A failed enqueue releases its delivery reservation
The reminder engine reserves a delivery row before sending; if the enqueue fails, it
deletes the reservation. **Why:** the ledger is what makes retries safe, but a
reservation that outlives a failed enqueue makes the message permanently unsendable —
the window can never fire again. Found because BullMQ rejected the job id and the email
was silently lost. **Consequence:** `QueueService.sendEmail` returns a boolean rather than
swallowing failure, and the caller compensates.

### D-039 · BullMQ job ids cannot contain a colon
Job ids are built as `email-<key with colons replaced>`. **Why:** BullMQ uses `:` as its
Redis key separator and rejects custom ids containing one. The original `email:<key>`
threw on every enqueue, and because the catch was deliberately non-fatal, emails were
dropped with only a log line. **Consequence:** ids are normalised centrally in
`QueueService`, and the failure log now states plainly that the recipient will not receive
the message.

### D-038 · The reminder scan is an internal HTTP endpoint, not worker-side logic
The worker calls `POST /api/v1/internal/reminders/scan`, authenticated by a constant-time
comparison of `SESSION_SECRET`, returning 404 (not 401) when unauthenticated.
**Why:** the scan crosses workspaces and needs the domain layer. Duplicating that logic in
the worker would give the engine two implementations that could drift.
**Alternatives:** import the service into the worker — rejected, because the worker would
then need the full Nest container and its own database client.
**Consequence:** one engine, one place to fix; the endpoint is excluded from the public
API surface and never called by a browser.

### D-037 · Unique-where operations merge the tenant scope instead of AND-wrapping
The Prisma tenant extension AND-composes `workspaceId` for filter operations, but merges
it for `findUnique`/`update`/`delete`/`upsert`. **Why:** Prisma requires a unique field in
those `where` clauses and rejects an `AND` wrapper outright — every `update` through the
scoped client failed with "needs at least one of id". **Consequence:** merging is still
safe because the scope is applied last, so a caller-supplied value can only be replaced,
never widened; the isolation suite now asserts both that own-row updates succeed and that
another tenant's row cannot be read, updated or deleted by id.

### D-036 · The generated tsvector column was replaced with trigram indexes
`vehicles.search_vector` was a PostgreSQL GENERATED column added in raw SQL. **Why:**
Prisma Migrate cannot model it, repeatedly tried to drop or alter it, and blocked every
subsequent migration. **Alternatives:** declare it as `Unsupported("tsvector")` — Prisma
still emitted an invalid ALTER. **Consequence:** GIN trigram indexes on manufacturer,
model, registration and VIN give the same lookup capability with partial matching, and
Prisma leaves them alone. ADR-009's conclusion (Postgres search, not Elasticsearch) is
unchanged; only the mechanism differs.

### D-035 · Extensions live in a migration, not only in the Docker init script
A `20260920000000_enable_extensions` migration creates `citext` and `pg_trgm`. **Why:**
Prisma's shadow database replays migrations into a fresh database that never ran the
Docker init script, so every `migrate dev` failed with `type "citext" does not exist`.
**Consequence:** migrations are self-contained — CI, the shadow database and a fresh
production database all get the extensions without out-of-band setup.

### D-034 · Suggested maintenance intervals are labelled as common practice
Built-in categories carry default intervals, and the UI states plainly that they are
common practice rather than manufacturer specifications. **Why:** presenting a generic
figure as manufacturer-approved would be worse than offering none — someone could skip a
timing belt on our say-so. **Consequence:** every interval is user-editable, an edit sets
`isUserOverridden`, and the disclaimer sits directly above the schedule.

### D-033 · `consistent-type-imports` is disabled for the API
NestJS DI relies on `emitDecoratorMetadata`, which emits `design:paramtypes` referencing
the **runtime value** of each constructor parameter type. **Why:** the rule flagged every
injected service (`PrismaService`, `AuditService`, `Reflector`); applying its autofix
would have erased those values and broken the container at boot — a failure the type
checker cannot see. **Consequence:** the rule stays on everywhere else and is off for
`apps/api/src/**`, with the reason recorded in that app's ESLint config.

### D-032 · TypeScript 6 is pinned inside the lint package only
`typescript-eslint` 8.70 hard-errors on the TS 7 API. **Why:** verified directly — it
refuses to load and points at the upstream tracking issue for TS ≥ 7.1 support. The
TypeScript team's documented remedy is a side-by-side TS 6 install.
**Alternatives:** drop typescript-eslint (loses every TS rule, including the ones
enforcing our invariants) or downgrade the whole project to TS 6 (gives up the native
compiler). **Consequence:** `packages/eslint-config` depends on `typescript@6.0.3`;
every build and typecheck still runs on TS 7. Revisit when typescript-eslint supports 7.x.

### D-031 · Security lint rules are verified to fire, not assumed
Each restricted-import and restricted-syntax rule was exercised against a deliberate
violation. **Why:** the cross-app rule silently did not fire — `no-restricted-imports`
matches the literal specifier, not the resolved path, so `**/apps/*/src/**` never
matched `../../admin/src/...`. A guard rule that never triggers is worse than none,
because it is believed. **Consequence:** the pattern list now covers relative escapes
and package names, and all five invariants are confirmed to error.

### D-030 · Sign-out performs a hard navigation
`signOut()` clears the query cache and then calls `window.location.assign('/sign-in')`.
**Why:** a client-side navigate left the dashboard rendering the previous user's data —
the API was correctly returning 401, but the UI had not re-derived its authenticated
state. **Consequence:** sign-out is treated as a security boundary; reloading guarantees
nothing keeps authenticated state in memory, instead of relying on cache-invalidation
timing. A failed logout call still signs the user out locally.

### D-029 · Links that look like buttons use `buttonClassName`, never a nested `<Button>`
`packages/ui` exports `buttonClassName()` alongside `<Button>`.
**Why:** `<Link><Button/></Link>` renders `<a><button>`, which is invalid HTML, puts two
interactive elements in the tab order, and lets the button swallow the click.
**Consequence:** navigation targets are anchors styled as buttons; `<Button>` is reserved
for real actions.

### D-028 · Workspace slugs carry a random suffix, not an id prefix
Registration builds `my-garage-<10 hex chars>` and retries up to five times on collision.
**Why:** the first implementation used `user.id.slice(0, 8)`. Ids are UUIDv7 and
time-ordered, so two users registering in the same window produced identical slugs and
the second signup failed with a 500. Found by a live browser test, not by review.
**Consequence:** an integration test registers five users concurrently and asserts all
five succeed.

### D-027 · Email idempotency uses an atomic reservation, not check-then-act
`EmailService.send()` reserves the idempotency key *before* sending, via an injectable
`IdempotencyStore`; the worker injects a Redis-backed store using `SET NX`.
**Why:** the first implementation checked a Set and added the key *after* the await. A
live test enqueued three jobs (two sharing a key) and all three sent — two concurrent
jobs both passed the check before either recorded it. An in-process Set also cannot
dedupe across replicas or restarts. **Consequence:** a failed send releases the
reservation so retries proceed; durable per-message history still lands in
`email_messages.idempotency_key` in Phase 5.

### D-026 · Log redaction matches a normalised key, not a substring list
`sanitiseMetadata` strips non-letters and lowercases a key before matching fragments.
**Why:** the original regex matched `apikey` but not `API_KEY` or `api-key`, so those
would have reached `audit_logs` in clear text. **Consequence:** `API_KEY`, `api-key`,
`apiKey` and `user_password_confirmation` are all caught; ordinary keys are untouched,
asserted by test.

### D-025 · Non-default host ports for the whole local stack
Apps run on 3100/3101/3102/4100 and infrastructure on 55432/56379/59000/59001/51025/58025,
overridable in `.env`. **Why:** the development machine already runs another
`infra` Compose project holding 5432, 6379, 9000/9001, 1025 and 8025, plus a process on
3000. Reusing them would have meant either a port clash or writing AutoServices tables
into another project's database. **Alternatives:** reuse the existing containers —
rejected, because AutoServices would break whenever that unrelated project was torn down.
**Consequence:** the documented defaults in `DEPLOYMENT.md` §1.3 are updated; container-
internal ports remain standard.

### D-024 · The API is ESM, with `.js` extensions on relative imports
NestJS 12 ships ESM only; a CommonJS build fails with TS1479 on every `@nestjs/*` import.
**Why:** verified by probe before committing to the stack. **Consequence:** `"type":
"module"`, `module: NodeNext`, and relative imports carry `.js` extensions.

### D-023 · TypeScript 7 configuration constraints
`moduleResolution: node10` has been removed, enum values are case-sensitive (`NodeNext`,
not `nodenext`), and `rootDir` must be explicit when `outDir` is set.
**Consequence:** encoded in `packages/tsconfig`; `emitDecoratorMetadata` was verified
working under TS 7 before choosing NestJS.

### D-022 · Prisma 7 needs a driver adapter and `prisma.config.ts`
Prisma 7 removed `url` from the `datasource` block. **Consequence:** `prisma.config.ts`
carries `datasource.url` for Migrate/Studio and a `PrismaPg` adapter for the runtime
client; `postinstall` regenerates the client, because an install wipes the generated
output and leaves the API uncompilable.

### D-021 · Composite tenant foreign keys live in schema.prisma
Prisma supports multi-field relations, so `(vehicle_id, workspace_id) -> (id,
workspace_id)` is expressed in the schema, not hand-written SQL. **Why:** `DATABASE.md`
originally asserted the opposite; it was wrong and has been corrected. **Consequence:**
only partial unique indexes, generated columns and functional indexes need raw SQL.

### D-020 · A development-only sign-in shortcut, guarded three ways
`POST /api/v1/auth/dev-login` issues a session for a seeded account with no password.
**Why:** the dashboard needed to be usable against real data before email verification
exists. **Consequence:** it requires `DEV_AUTH_ENABLED=true`, returns 404 unless that
flag is set, throws if `NODE_ENV=production`, and `packages/config` refuses to load a
production config with the flag on. Real registration and login are implemented and work;
this only skips the password.

---

## 2026-09-20 — Phase 0

### D-018 · Tasks in later phases are listed compactly, not fully specified
Phases 3–12 appear in `TASKS.md` as ID/title/priority/dependency rows, expanded to full
task blocks when promoted to `READY`. **Why:** specifying a task twelve weeks before
implementing it means specifying it twice, and the second version is the only one anyone
reads. Dependency ordering — the part that matters for planning — is captured now.
**Consequence:** promotion to `READY` includes writing the full block.

### D-017 · Prisma pinned to 7.10.x, not 8.x
Prisma's `latest` npm tag currently points at `8.0.0-rc.15`; the stable release is 7.10.0.
**Why:** a release candidate is not a foundation for the data layer. **Consequence:**
revisit after 8.x is stable; migration is expected to be routine.

### D-019 · Target Node 26 although Node 24 is today's LTS
Node 26 enters Active LTS in October 2026; Node 24 "Krypton" is LTS today. **Why:** the
development machine already runs 26.8.2, and the LTS transition lands before Phase 2
begins. **Alternatives:** pin to 24 and upgrade later — safer, but means an upgrade during
active development for no current benefit. **Consequence:** if 26 causes a problem before
October, dropping to 24 is a change to `.nvmrc`, the Docker base image and CI.

### D-016 · pnpm installed globally, not via Corepack
Node 26 no longer bundles Corepack, so `npm install -g pnpm@12` is a documented
prerequisite. **Why:** the previously idiomatic `corepack enable` no longer works.
**Consequence:** `packageManager` in the root `package.json` remains the pinned source of
truth; CI installs pnpm explicitly.

### D-015 · Money is a string over the wire
API responses carry `{ "amount": "129.99", "currency": "GBP" }`, never a JSON number.
**Why:** JSON numbers are IEEE-754 doubles; `0.1 + 0.2` in a client is a support ticket.
**Alternatives:** integer minor units — correct, but leaks currency-specific exponent
handling into every client. **Consequence:** clients parse with a decimal library;
`packages/types` provides the helpers.

### D-014 · Calendar dates are `date` columns, not timestamps
Expiries, service dates and purchase dates are `date`; only instants are `timestamptz`.
**Why:** an MOT expiring on 2026-11-30 expires on that date everywhere. Storing it as a
timestamp means a user in UTC+13 sees it expire a day early. **Consequence:** the API
carries `YYYY-MM-DD` strings for these fields and never converts them through a timezone.

### D-013 · Distance stored as entered, with its unit
The user's original value and unit are preserved; metres (integer) is the canonical unit
for *computation* only. **Why:** a service book that says 150,000 miles should still say
that in ten years, not 241,402 km. **Consequence:** branded `Miles`/`Kilometers` types make
mixing them a compile error; conversion happens explicitly at computation and display
boundaries.

### D-012 · Cross-tenant access returns 404, not 403
A request for a resource in a workspace the user does not belong to returns 404.
**Why:** 403 confirms the resource exists, which is an enumeration oracle.
**Consequence:** inside a workspace the user *does* belong to, 403 is correct and used —
the distinction is tested.

### D-011 · `workspace_id` denormalised onto grandchild tables
`service_parts`, `inspection_advisories` and similar carry `workspace_id` even though it is
derivable from their parent. **Why:** it is what makes the composite foreign key
`(parent_id, workspace_id)` possible, so the database itself rejects a cross-workspace
pair. **Alternatives:** derive via join — correct but unenforceable at the database layer.
**Consequence:** slightly wider rows; an integrity guarantee that survives application bugs.

### D-010 · Row-Level Security is a later hardening layer, not the primary control
Isolation is enforced by a Prisma client extension plus composite foreign keys. **Why:**
RLS depends on a per-request session variable, which interacts badly with connection
pooling and Prisma's transaction model — a pooled connection carrying a stale setting is a
leak. **Consequence:** every tenant row already carries `workspace_id`, so adding RLS later
requires policies only, not a migration. Recorded in ADR-002.

### D-009 · The tenant-owned model set is derived from the schema
The Prisma extension identifies tenant models by the presence of a `workspaceId` field via
the DMMF, rather than from a hand-maintained list. **Why:** a hand-maintained list is
exactly what gets forgotten when someone adds a table late on a Friday. **Consequence:**
adding `workspaceId` to a model opts it into protection automatically; the isolation suite
is generated from the same source.

### D-008 · Reminder emails send at 09:00 in the recipient's local timezone
An hourly scheduler processes only the timezone buckets currently at the send hour.
**Why:** a single nightly UTC batch either wakes people at 3 a.m. or creates a thundering
herd. **Consequence:** the scheduler runs 24 times a day doing 1/24 of the work each time;
quiet hours (21:00–07:00 local) defer non-critical mail to the next morning.

### D-007 · Every email is idempotency-keyed
`sha256(workspaceId | reminderId | channel | recipientId | windowKey)` with a unique
constraint on the delivery row. **Why:** BullMQ retries, worker crashes and duplicate
scheduler runs must never produce a second email. **Consequence:** the delivery row is
inserted *before* sending; a unique violation means "already handled" and the job succeeds
without sending.

### D-006 · `email_messages` is written before the provider call
**Why:** support must be able to answer "was it sent?" even when the provider call itself
failed. Relying on the Resend dashboard as historical storage is not an option — retention
is limited and it is not queryable from the admin app. **Consequence:** a row in `QUEUED`
with no terminal event after 24 hours is flagged for reconciliation.

### D-005 · Email status transitions are rank-ordered, never assigned
A late-arriving `sent` webhook cannot overwrite `delivered`. **Why:** provider events
arrive out of order. **Consequence:** transitions compare status rank; regressions are
ignored but still appended to `email_delivery_events`.

### D-004 · Expenses are the single cost surface, populated by projection
Services, fuel, insurance premiums and tax payments project a row into `expenses` with
`source_type`/`source_record_id`. **Why:** the user enters a cost once; reports read one
table. **Consequence:** reports count projections only, never the source record as well —
double counting is a specific tested risk.

### D-003 · `parts_total` + `labour_total` need not equal `total_amount`
**Why:** real invoices include discounts, rounding and fees. Enforcing the sum would force
users to lie to the form. **Consequence:** `total_amount` is authoritative for all
reporting; the breakdown is informational.

### D-002 · Fuel economy is computed tank-to-tank between full fills
Partial fills accumulate into the next full-fill interval and are never interval endpoints.
**Why:** a partial fill gives no reliable consumption reading, and treating it as one
produces wild figures that make users distrust every number in the product.
**Consequence:** economy appears only after two full fills; the UI says so rather than
showing a wrong number.

### D-001 · Odometer history is append-only; current mileage is a cache
Corrections are new entries flagged `is_correction` with a reason, never edits.
**Why:** mileage history is evidence — for maintenance accuracy, for resale, and
potentially in a dispute. **Consequence:** `vehicles.current_odometer` is maintained in the
same transaction as any odometer write and is never the source of truth.

---

## Template

```markdown
### D-NNN · <decision in one line>
<What was decided.> **Why:** <the reason, including what would go wrong otherwise.>
**Alternatives:** <what else was considered and why it lost.>
**Consequence:** <what this now obliges us to do.>
```
