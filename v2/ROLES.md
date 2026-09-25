# Roles & membership

How CounciLog decides who can do what, and how to manage it day to day.

## The four roles

Roles are **per organization** — the same account can be an owner in one org
and a member in another.

| Role | Can do |
|---|---|
| **owner** | Everything: manage members & roles, mint invites, approve join requests, edit positions/duty/templates/chains/contacts, view audit log, plus everything below. Set at org creation; can't be granted later via the API. |
| **adviser** | Oversight: read everything, view the audit log, create/edit projects, register documents. Cannot manage members or org structure. |
| **officer** | Daily work: journal entries + photos, check off checklist items, register documents, log movements, sign/skip/send-back signatory steps, bulk-sign the current round, attach chains to unrouted docs. |
| **member** | Journal entries and own attendance, read access to shared surfaces. |

Enforcement is server-side: every org-scoped endpoint checks membership
(non-members get `404` — the org is invisible, not "forbidden") and the
minimum role (`403` for insufficient role). Removed members lose access on
their next request.

A user sees their own role capabilities spelled out on the **Account** page
(`/account` → "What you can do") — one card per org they belong to.

## How people join

Two doors, both handled on the **join** screen after sign-up:

1. **Invite code** — an owner mints one in **Settings → invites** and picks
   the role (officer/adviser/member). Whoever redeems the code joins
   instantly *at that role*. Codes are single-use by default and expire
   (default 7 days, max 30). Share officer invites carefully — they're
   capability grants, not just access.
2. **Join request** — the requester pastes the **Organization ID**
   (admins copy it from the card at the top of **Settings**) plus an
   optional message. The owner approves *with a chosen role* or rejects in
   **Settings → invites → Pending join requests**.

The person who creates an org becomes its owner automatically.

## Changing roles / removing people

**Members → Roster** or **Settings → members** — same controls in both:

- Role dropdown per member (`adviser` / `officer` / `member`) — takes effect
  immediately.
- Remove button (✕/UserX icon) → confirmation → member loses access. Their
  journal entries, movements, and audit history stay on record — removal is
  a status change, not a deletion.

Rules the API enforces (you'll get a clean error if you try):

- You **can't change your own role** — prevents the last owner locking
  themselves out.
- `owner` is **not assignable** via the API — it's granted only at org
  creation. To hand ownership to someone else is a deliberate operation;
  ask in the project if you need it.
- Only **owners** can mint invites, approve join requests, change roles, or
  remove members.

## For developers

| Operation | Endpoint | Min role |
|---|---|---|
| Mint invite | `POST /orgs/{id}/invites` | owner |
| Redeem invite | `POST /invites/{code}/redeem` | any signed-in user |
| File join request | `POST /orgs/{id}/join-requests` | any non-member |
| Approve/reject (+ role) | `POST /orgs/{id}/join-requests/{rid}/decide` | owner |
| Change role / remove | `PATCH /orgs/{id}/members/{user_id}` | owner |
| List members | `GET /orgs/{id}/members` | member |

See `spec.md` §Security for the full RBAC matrix and threat model.
