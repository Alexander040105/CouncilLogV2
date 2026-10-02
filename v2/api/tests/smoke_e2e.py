"""End-to-end smoke test: real Supabase auth + migrated DB + storage."""
import json, os, sys, time, urllib.request, urllib.error

SUPA = "https://ijcjzllfusxpfqqonuyk.supabase.co"
ANON = os.environ["SUPABASE_ANON_KEY"]
SERVICE = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
API = "http://localhost:8000/api/v1"

PASS = "TestPass_2026!"
EMAIL_A = "dev-owner@councilog.test"
EMAIL_B = "dev-member@councilog.test"
EMAIL_C = "dev-outsider@councilog.test"
EMAIL_D = "dev-stranger@councilog.test"

def call(method, url, key, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", key)
    if token: req.add_header("Authorization", f"Bearer {token}")
    elif key: req.add_header("Authorization", f"Bearer {key}")
    if data: req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")

def api(method, path, token, body=None, org=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if org: req.add_header("x-org-id", org)
    if data: req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")

ok, fail = [], []
def check(name, cond, extra=""):
    (ok if cond else fail).append(name)
    print(("PASS " if cond else "FAIL ") + name + (f"  | {extra}" if extra else ""))

# ── 1. Create users (admin API -> already confirmed) ─────────────────────
def ensure_user(email):
    s, r = call("POST", f"{SUPA}/auth/v1/admin/users", SERVICE,
                {"email": email, "password": PASS, "email_confirm": True})
    if s >= 400 and "already" not in json.dumps(r):
        print("admin create failed", s, r); sys.exit(1)
    # resolve id (create may have no-op'd on an existing user), then unban -
    # earlier runs may have left the account banned by the DELETE /me check
    s, r = call("GET", f"{SUPA}/auth/v1/admin/users?page=1&per_page=100", SERVICE)
    uid = next((u["id"] for u in r.get("users", []) if u["email"] == email), None)
    if uid:
        call("PUT", f"{SUPA}/auth/v1/admin/users/{uid}", SERVICE,
             {"ban_duration": "none"})
    # sign in to get token
    s, r = call("POST", f"{SUPA}/auth/v1/token?grant_type=password", ANON,
                {"email": email, "password": PASS})
    if s >= 400: print("signin failed", s, r); sys.exit(1)
    return r["access_token"], r["user"]["id"]

tok_a, uid_a = ensure_user(EMAIL_A)
tok_b, uid_b = ensure_user(EMAIL_B)
tok_c, uid_c = ensure_user(EMAIL_C)
tok_d, uid_d = ensure_user(EMAIL_D)
check("supabase auth: 4 users signed in", all([tok_a, tok_b, tok_c, tok_d]))

# ── 2. Auth guards ──────────────────────────────────────────────────────
s, _ = api("GET", "/me", token="bogus")
check("rejects bad token", s == 401, f"{s}")

# ── 3. Org create + memberships ─────────────────────────────────────────
SLUG = f"ccs-smoke-{int(time.time())}"
s, r = api("POST", "/orgs", tok_a, {"name": "CCS Council", "slug": SLUG, "school_year_label": "SY 2025-2026"})
org_a = r.get("id") or (r.get("data") or {}).get("id")
check("owner creates org", s in (200, 201) and org_a, f"{s} {str(r)[:120]}")

s, me_a = api("GET", "/me", tok_a)
check("/me returns membership", any(m["org_id"] == org_a for m in me_a["memberships"]))

# outsider cannot see org
s, _ = api("GET", f"/orgs/{org_a}", tok_c, org=org_a)
check("cross-org read denied (404)", s in (403, 404), f"{s}")

# owner mints invite -> member redeems
s, inv = api("POST", f"/orgs/{org_a}/invites", tok_a, {"role": "officer"}, org=org_a)
check("owner mints invite", s == 201 and inv.get("code"), f"{s}")
s, r = api("POST", f"/invites/{inv['code']}/redeem", tok_b)
check("member redeems invite", s == 201 and r.get("org_id") == org_a, f"{s} {str(r)[:120]}")

# join request + approve
s, r = api("POST", f"/orgs/{org_a}/join-requests", tok_c, {"message": "hi"})
check("outsider files join request", s == 201, f"{s}")
s, reqs = api("GET", f"/orgs/{org_a}/join-requests", tok_a, org=org_a)
rid = reqs["data"][0]["id"] if s == 200 and reqs["data"] else None
s, r = api("POST", f"/orgs/{org_a}/join-requests/{rid}/decide", tok_a, {"approve": True}, org=org_a) if rid else (0, {})
check("owner approves join request", s == 200, f"{s} {str(r)[:100]}")

# ── 4. Org structure ────────────────────────────────────────────────────
s, r = api("POST", f"/orgs/{org_a}/positions", tok_a, {"title": "President", "rank": 1, "holder": uid_a}, org=org_a)
check("owner creates position", s == 201, f"{s} {str(r)[:100]}")
s, r = api("PUT", f"/orgs/{org_a}/duty-schedule", tok_a, {"schedule": {"0": [uid_a], "2": [uid_b]}}, org=org_a)
check("owner sets duty schedule", s == 200, f"{s}")
s, r = api("GET", f"/orgs/{org_a}/org-chart", tok_b, org=org_a)
check("member reads org chart", s == 200 and r["data"], f"{s}")
# officer cannot do owner-only writes
s, r = api("POST", f"/orgs/{org_a}/positions", tok_b, {"title": "Nope"}, org=org_a)
check("officer blocked from owner write", s == 403, f"{s}")

# ── 5. Journal + attendance ─────────────────────────────────────────────
s, r = api("POST", f"/orgs/{org_a}/journal", tok_b,
           {"description": "Drafted concept paper for web dev seminar"}, org=org_a)
check("member posts journal entry", s == 201, f"{s} {str(r)[:150]}")
check("-> attendance auto-documented", r.get("attendance", {}).get("status") == "documented")
jid = r["data"]["id"] if s == 201 else None

s, r = api("POST", f"/orgs/{org_a}/attendance/no-tasks", tok_a, {}, org=org_a)
check("owner declares no-tasks", s == 201 and r["data"]["status"] == "declared_no_tasks", f"{s}")
s, r = api("GET", f"/orgs/{org_a}/attendance", tok_a, org=org_a)
check("attendance list + unaccounted", s == 200 and "unaccounted_member_ids" in r, f"{s}")
s, r = api("GET", f"/orgs/{org_a}/attendance/summary", tok_a, org=org_a)
check("attendance summary", s == 200 and "data" in r, f"{s} {str(r)[:120]}")

# photo sign -> upload (tiny png) -> attach -> view url
s, sign = api("POST", f"/orgs/{org_a}/journal/photos/sign", tok_b,
              {"mime": "image/png", "byte_size": 68}, org=org_a)
check("photo upload signed URL minted", s == 201 and sign.get("upload_url"), f"{s} {str(sign)[:100]}")
if s == 201:
    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c489") + b"\x00" * 40
    req = urllib.request.Request(sign["upload_url"], data=png, method="PUT")
    req.add_header("Content-Type", "image/png")
    try:
        urllib.request.urlopen(req); up_ok = True
    except Exception as e:
        up_ok = False; print("   upload err:", str(e)[:120])
    check("photo bytes PUT to storage", up_ok)
    s, r = api("POST", f"/orgs/{org_a}/journal", tok_b,
               {"description": "with photo",
                "photos": [{"storage_path": sign["path"], "mime": "image/png", "byte_size": len(png)}]}, org=org_a)
    check("entry w/ photo verified by magic bytes", s == 201, f"{s} {str(r)[:150]}")
    if s == 201:
        s2, feed = api("GET", f"/orgs/{org_a}/journal", tok_a, org=org_a)
        pid = feed["data"][0]["photos"][0]["id"] if feed["data"] and feed["data"][0].get("photos") else None
        if pid:
            s3, u = api("GET", f"/orgs/{org_a}/photos/{pid}/url", tok_a, org=org_a)
            check("download URL minted post-authz", s3 == 200 and "token" in u.get("url", ""), f"{s3}")
            s4, _ = api("GET", f"/orgs/{org_a}/photos/{pid}/url", tok_d, org=org_a)
            check("outsider cannot mint photo URL", s4 in (403, 404), f"{s4}")

# ── 5b. Journal/attendance corrections ──────────────────────────────────
s, r = api("PATCH", f"/orgs/{org_a}/journal/{jid}", tok_b,
           {"description": "Drafted concept paper for web dev seminar (fixed)"}, org=org_a)
check("author edits own same-day entry", s == 200 and r["data"]["description"].endswith("(fixed)"), f"{s}")
s, r = api("PATCH", f"/orgs/{org_a}/journal/{jid}", tok_d,
           {"description": "intruder"}, org=org_a)
check("outsider cannot edit entry", s in (403, 404), f"{s}")

# attendance retract: documented day must 409, declared_no_tasks retracts clean
s, rows = api("GET", f"/orgs/{org_a}/attendance", tok_a, org=org_a)
b_row = next((x for x in rows["data"] if x.get("status") == "documented"), None)
if b_row:
    s, r = api("DELETE", f"/orgs/{org_a}/attendance/{b_row['day']}?member_id={b_row['member_id']}", tok_a, org=org_a)
    check("retracting a documented day 409s", s == 409, f"{s}")
a_row = next((x for x in rows["data"] if x.get("status") == "declared_no_tasks"), None)
if a_row:
    s, r = api("DELETE", f"/orgs/{org_a}/attendance/{a_row['day']}?member_id={a_row['member_id']}", tok_a, org=org_a)
    check("declared_no_tasks retracts", s == 200 and r["data"]["deleted"], f"{s}")

s, r = api("DELETE", f"/orgs/{org_a}/journal/{jid}", tok_b, org=org_a)
check("author deletes own same-day entry", s == 200 and r["data"]["deleted"], f"{s}")
s, feed = api("GET", f"/orgs/{org_a}/journal", tok_a, org=org_a)
check("deleted entry absent from feed", all(x["id"] != jid for x in feed["data"]), f"{s}")

# ── 6. Projects + checklists ────────────────────────────────────────────
s, tpl = api("POST", f"/orgs/{org_a}/checklist-templates", tok_a,
             {"name": "Paper processing", "track": "paper",
              "items": [{"ord": 1, "label": "Draft concept paper"},
                        {"ord": 2, "label": "Board resolution", "rule_json": {"include_if_flag": "needs_resolution"}}]},
             org=org_a)
check("owner creates checklist template", s == 201, f"{s}")
s, proj = api("POST", f"/orgs/{org_a}/projects", tok_a,
              {"title": "Web Dev Seminar", "event_type": "seminar", "target_date": "2026-03-15",
               "needs_paper_processing": True}, org=org_a)
check("owner creates project", s == 201, f"{s}")
pid = proj["data"]["id"] if s == 201 else None
s, r = api("POST", f"/orgs/{org_a}/projects/{pid}/instantiate", tok_a, {}, org=org_a)
check("instantiate checklist", s == 201 and r.get("instantiated_items", 0) >= 1,
      f"{s} {str(r)[:120]} (flag-gated items skipped)")
s, r = api("GET", f"/orgs/{org_a}/projects/{pid}", tok_b, org=org_a)
item = r["checklist"][0] if s == 200 and r["checklist"] else None
if item:
    s, r = api("PATCH", f"/orgs/{org_a}/checklist-items/{item['id']}", tok_b, {"done": True}, org=org_a)
    check("officer checks item", s == 200 and r["data"]["done"], f"{s}")

# ── 6b. Template PATCH/DELETE, flags, instantiate guard ────────────────
tpl_id = tpl["data"]["id"]
s, r2 = api("POST", "/orgs", tok_c, {"name": "Other Dept", "slug": f"{SLUG}-other", "school_year_label": "SY 2025-2026"})
org_c = r2.get("id") or (r2.get("data") or {}).get("id")

# cross-org isolation on the new endpoints (org_c owner poking org_a rows)
s, r = api("PATCH", f"/orgs/{org_c}/checklist-templates/{tpl_id}", tok_c, {"name": "hijack"}, org=org_c)
check("cross-org template patch -> 404", s == 404, f"{s}")
s, r = api("DELETE", f"/orgs/{org_c}/checklist-templates/{tpl_id}", tok_c, org=org_c)
check("cross-org template delete -> 404", s == 404, f"{s}")

# owner PATCH: rename + wholesale item replace
s, r = api("PATCH", f"/orgs/{org_a}/checklist-templates/{tpl_id}", tok_a,
           {"name": "Paper processing v2",
            "items": [{"ord": 1, "label": "Draft concept paper"},
                      {"ord": 2, "label": "CHED letter",
                       "rule_json": {"include_if_flag": "off_campus",
                                     "due_days_before_event": 15}}]}, org=org_a)
check("owner patches template", s == 200 and r["data"]["name"] == "Paper processing v2", f"{s}")
s, r = api("GET", f"/orgs/{org_a}/checklist-templates", tok_a, org=org_a)
tp = next((t for t in r["data"] if t["id"] == tpl_id), None)
check("patch replaced items wholesale", tp and len(tp["items"]) == 2 and tp["items"][1]["label"] == "CHED letter",
      str(tp)[:140] if tp else "not found")

# non-owner writes denied
s, r = api("PATCH", f"/orgs/{org_a}/checklist-templates/{tpl_id}", tok_b, {"name": "x"}, org=org_a)
check("officer cannot patch template", s == 403, f"{s}")
s, r = api("DELETE", f"/orgs/{org_a}/checklist-templates/{tpl_id}", tok_b, org=org_a)
check("officer cannot delete template", s == 403, f"{s}")

# re-instantiate populated project -> 409; append=true -> duplicates on purpose
s, r = api("POST", f"/orgs/{org_a}/projects/{pid}/instantiate", tok_a, {}, org=org_a)
check("re-instantiate -> 409 ALREADY_INSTANTIATED",
      s == 409 and r["error"]["code"] == "ALREADY_INSTANTIATED", f"{s} {str(r)[:120]}")
s, r = api("POST", f"/orgs/{org_a}/projects/{pid}/instantiate", tok_a, {"append": True}, org=org_a)
check("append=true re-instantiates", s == 201 and r.get("instantiated_items", 0) >= 1, f"{s}")

# flags: a flagged project picks up the flag-gated CHED item (due T-15d)
s, proj2 = api("POST", f"/orgs/{org_a}/projects", tok_a,
               {"title": "Educ Tour", "event_type": "educ_tour", "target_date": "2026-11-30",
                "needs_paper_processing": True, "flags": {"off_campus": True}}, org=org_a)
pid2 = (proj2.get("data") or {}).get("id") if s == 201 else None
check("project persists flags", s == 201 and (proj2.get("data") or {}).get("flags", {}).get("off_campus") is True,
      f"{s} {str(proj2)[:140]}")
s, r = api("POST", f"/orgs/{org_a}/projects/{pid2}/instantiate", tok_a, {}, org=org_a)
check("flagged project instantiates gated item", s == 201 and r.get("instantiated_items") == 2, f"{s} {str(r)[:120]}")
s, r = api("GET", f"/orgs/{org_a}/projects/{pid2}", tok_a, org=org_a)
ched = [i for i in r.get("checklist", []) if "CHED" in i["label"]]
check("CHED due = target - 15d", ched and ched[0].get("due_date") == "2026-11-15", str(ched)[:160])

# unflagged same-type project does NOT get the gated item
s, proj3 = api("POST", f"/orgs/{org_a}/projects", tok_a,
               {"title": "Plain Trip", "event_type": "educ_tour",
                "needs_paper_processing": True}, org=org_a)
pid3 = (proj3.get("data") or {}).get("id") if s == 201 else None
s, r = api("POST", f"/orgs/{org_a}/projects/{pid3}/instantiate", tok_a, {}, org=org_a)
check("unflagged project skips gated item", s == 201 and r.get("instantiated_items") == 1, f"{s} {str(r)[:120]}")

# template delete: instances keep their snapshot, template_id nulls
s, r = api("GET", f"/orgs/{org_a}/projects/{pid2}", tok_a, org=org_a)
pre_del = len(r.get("checklist", []))
s, r = api("DELETE", f"/orgs/{org_a}/checklist-templates/{tpl_id}", tok_a, org=org_a)
check("owner deletes template", s == 200, f"{s}")
s, r = api("GET", f"/orgs/{org_a}/projects/{pid2}", tok_a, org=org_a)
check("checklist survives template delete (SET NULL provenance)",
      s == 200 and len(r.get("checklist", [])) == pre_del
      and all(i["template_id"] is None for i in r.get("checklist", [])),
      f"{s} {str(r.get('checklist'))[:140]}")

# ── 7. Documents ────────────────────────────────────────────────────────
s, ch = api("POST", f"/orgs/{org_a}/signatory-chains", tok_a,
            {"name": "Concept paper route", "doc_type": "concept_paper",
             "steps": [{"ord": 1, "label": "Adviser"}, {"ord": 2, "label": "SD office"}]}, org=org_a)
check("owner creates signatory chain", s == 201, f"{s}")
s, doc = api("POST", f"/orgs/{org_a}/documents", tok_a,
             {"title": "WDS concept paper", "doc_type": "concept_paper", "project_id": pid}, org=org_a)
check("officer registers document", s == 201, f"{s}")
did = doc["data"]["id"] if s == 201 else None
s, d = api("GET", f"/orgs/{org_a}/documents/{did}", tok_b, org=org_a)
check("chain auto-instantiated", s == 200 and len(d.get("signatory_steps", [])) == 2, f"{s} steps={len(d.get('signatory_steps',[]))}")
s, mv1 = api("POST", f"/orgs/{org_a}/documents/{did}/movements", tok_a,
           {"location_text": "SD office inbox tray"}, org=org_a)
check("movement logged (append-only)", s == 201, f"{s}")
mv1_id = mv1["data"]["id"] if s == 201 else None
step = d["signatory_steps"][0]
s, r = api("POST", f"/orgs/{org_a}/documents/{did}/steps/{step['id']}", tok_b, {"status": "signed"}, org=org_a)
check("signatory step signed", s == 200, f"{s}")
s, d = api("GET", f"/orgs/{org_a}/documents/{did}", tok_a, org=org_a)
check("current_location = SD office", d.get("current_location") == "SD office inbox tray")

# movement corrections: patch + delete restores previous location
s, r = api("PATCH", f"/orgs/{org_a}/documents/{did}/movements/{mv1_id}", tok_a,
           {"location_text": "SD office — corrected"}, org=org_a)
check("mover edits own movement", s == 200 and r["data"]["location_text"].endswith("corrected"), f"{s}")
s, mv2 = api("POST", f"/orgs/{org_a}/documents/{did}/movements", tok_a,
             {"location_text": "Registrar"}, org=org_a)
check("second movement logged", s == 201, f"{s}")
mv2_id = mv2["data"]["id"] if s == 201 else None
s, r = api("DELETE", f"/orgs/{org_a}/documents/{did}/movements/{mv2_id}", tok_a, org=org_a)
check("newest movement deleted", s == 200 and r["data"]["deleted"], f"{s}")
s, d = api("GET", f"/orgs/{org_a}/documents/{did}", tok_a, org=org_a)
check("location falls back to previous movement",
      d.get("current_location") == "SD office — corrected", f"got {d.get('current_location')!r}")

# ── 7b. Revision rounds ─────────────────────────────────────────────────
s, ch2 = api("POST", f"/orgs/{org_a}/signatory-chains", tok_a,
             {"name": "Three-desk route", "doc_type": "board_resolution",
              "steps": [{"ord": 1, "label": "Dean"},
                        {"ord": 2, "label": "SSC President"},
                        {"ord": 3, "label": "SD"}]}, org=org_a)
check("owner creates 3-step chain", s == 201, f"{s}")
s, doc2 = api("POST", f"/orgs/{org_a}/documents", tok_b,
              {"title": "Budget request", "doc_type": "board_resolution"}, org=org_a)
did2 = doc2["data"]["id"] if s == 201 else None
s, d2 = api("GET", f"/orgs/{org_a}/documents/{did2}", tok_b, org=org_a)
st = d2["signatory_steps"]
check("3 steps at round 1", len(st) == 3 and all(x["round_no"] == 1 for x in st), f"{s}")

s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/steps/{st[0]['id']}", tok_b,
           {"status": "signed"}, org=org_a)
check("step 1 signed", s == 200, f"{s}")

s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_b,
           {"at_step_id": st[2]["id"], "resend_step_ids": [st[0]["id"]]}, org=org_a)
check("revision without note -> 422", s == 422, f"{s}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_b,
           {"at_step_id": st[2]["id"], "note": "fix",
            "resend_step_ids": ["00000000-0000-0000-0000-000000000000"]}, org=org_a)
check("unknown resend id -> 404", s == 404, f"{s}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_b,
           {"at_step_id": st[2]["id"], "return_to_step_id": st[0]["id"],
            "note": "pick one", "resend_step_ids": [st[0]["id"]]}, org=org_a)
check("both triggers -> 422", s == 422, f"{s}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_b,
           {"at_step_id": st[2]["id"], "note": "revise budget table",
            "resend_step_ids": [st[0]["id"], st[1]["id"]]}, org=org_a)
check("mid-route revision created", s == 201, f"{s} {str(r)[:140]}")
s, d2 = api("GET", f"/orgs/{org_a}/documents/{did2}", tok_b, org=org_a)
st2 = d2["signatory_steps"]
r2 = [x for x in st2 if x["round_no"] == 2]
check("doc status revision", d2["data"]["status"] == "revision", d2["data"]["status"])
check("requester marked revision_requested",
      next(x for x in st2 if x["id"] == st[2]["id"])["status"] == "revision_requested")
check("stale pending superseded",
      next(x for x in st2 if x["id"] == st[1]["id"])["status"] == "superseded")
check("round 2 = resend + carried pending + requester copy",
      len(r2) == 3 and all(x["status"] == "pending" and x["revises"] for x in r2),
      str(r2)[:140])
check("carried pending clones into round 2",
      any(x["revises"] == st[1]["id"] for x in r2), str(r2)[:140])
check("revisions list + current_round=2",
      len(d2.get("revisions", [])) == 1 and d2.get("current_round") == 2)

s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/steps/{st[1]['id']}", tok_b,
           {"status": "signed"}, org=org_a)
check("superseded step closed -> 409", s == 409, f"{s}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/steps/sign-all", tok_b,
           {"step_ids": [st[0]["id"]]}, org=org_a)
check("sign-all stale id -> 409", s == 409, f"{s}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/steps/sign-all", tok_b, {}, org=org_a)
check("sign-all current round", s == 200, f"{s} {str(r)[:100]}")
s, d2 = api("GET", f"/orgs/{org_a}/documents/{did2}", tok_a, org=org_a)
check("doc signed after round 2", d2["data"]["status"] == "signed", d2["data"]["status"])
check("round-1 history intact",
      next(x for x in d2["signatory_steps"] if x["id"] == st[0]["id"])["status"] == "signed")

s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_a,
           {"note": "late", "resend_step_ids": []}, org=org_a)
check("late revision empty resend -> 422", s == 422, f"{s}")
resolved2 = [x for x in d2["signatory_steps"] if x["status"] == "signed"]
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_a,
           {"note": "SD wants page 2 re-signed", "resend_step_ids": [resolved2[0]["id"]]},
           org=org_a)
check("late revision on signed doc", s == 201, f"{s} {str(r)[:120]}")
s, d2 = api("GET", f"/orgs/{org_a}/documents/{did2}", tok_a, org=org_a)
check("doc back to revision, round 3",
      d2["data"]["status"] == "revision" and d2.get("current_round") == 3)

# return_to_step_id — bounce a resolved desk back into a new round
pending3 = [x for x in d2["signatory_steps"] if x["status"] == "pending"]
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_a,
           {"return_to_step_id": pending3[0]["id"], "note": "still open"},
           org=org_a)
check("return_to pending step -> 422", s == 422, f"{s}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/steps/sign-all", tok_b, {}, org=org_a)
check("round 3 signs off", s == 200, f"{s}")
s, d2 = api("GET", f"/orgs/{org_a}/documents/{did2}", tok_a, org=org_a)
resolved3 = [x for x in d2["signatory_steps"] if x["status"] == "signed"]
s, r = api("POST", f"/orgs/{org_a}/documents/{did2}/revisions", tok_a,
           {"return_to_step_id": resolved3[0]["id"],
            "note": "Dean needs to sign again"}, org=org_a)
check("return_to_step_id revision", s == 201, f"{s} {str(r)[:120]}")
s, d2 = api("GET", f"/orgs/{org_a}/documents/{did2}", tok_a, org=org_a)
r4 = [x for x in d2["signatory_steps"] if x["round_no"] == 4]
check("round 4 = returned step only",
      d2["data"]["status"] == "revision" and len(r4) == 1
      and r4[0]["revises"] == resolved3[0]["id"], str(r4)[:140])

s, doc3 = api("POST", f"/orgs/{org_a}/documents", tok_b,
              {"title": "No chain", "doc_type": "letter"}, org=org_a)
did3 = doc3["data"]["id"] if s == 201 else None
s, r = api("POST", f"/orgs/{org_a}/documents/{did3}/revisions", tok_b,
           {"note": "x"}, org=org_a)
check("unrouted doc revision -> 409", s == 409, f"{s}")

# ── 7c. Chain PATCH/DELETE + conditional steps ─────────────────────────
ch_id = ch["data"]["id"]
s, r = api("PATCH", f"/orgs/{org_c}/signatory-chains/{ch_id}", tok_c, {"name": "hijack"}, org=org_c)
check("cross-org chain patch -> 404", s == 404, f"{s}")
s, r = api("DELETE", f"/orgs/{org_c}/signatory-chains/{ch_id}", tok_c, org=org_c)
check("cross-org chain delete -> 404", s == 404, f"{s}")
s, r = api("PATCH", f"/orgs/{org_a}/signatory-chains/{ch_id}", tok_b, {"name": "x"}, org=org_a)
check("officer cannot patch chain", s == 403, f"{s}")

# owner PATCH: add conditional RFP + Marketing steps to the concept-paper chain
s, r = api("PATCH", f"/orgs/{org_a}/signatory-chains/{ch_id}", tok_a,
           {"steps": [{"ord": 1, "label": "Adviser"},
                      {"ord": 2, "label": "RFP desk",
                       "condition_json": {"include_if_event_type": "webinar_intl"}},
                      {"ord": 3, "label": "Marketing",
                       "condition_json": {"include_if_flag": "has_merch"}},
                      {"ord": 4, "label": "SD office"}]}, org=org_a)
check("owner patches chain steps", s == 200, f"{s}")

# already-routed doc keeps its snapshot — chain edits don't rewrite live routes
s, d = api("GET", f"/orgs/{org_a}/documents/{did}", tok_a, org=org_a)
check("routed doc keeps old snapshot after chain edit",
      s == 200 and len(d.get("signatory_steps", [])) == 2
      and "RFP" not in str(d.get("signatory_steps")), f"{s} {str(d.get('signatory_steps'))[:140]}")

# event-type-gated step fires only via the linked project's event_type
s, proj4 = api("POST", f"/orgs/{org_a}/projects", tok_a,
               {"title": "Intl Webinar", "event_type": "webinar_intl"}, org=org_a)
pid4 = (proj4.get("data") or {}).get("id") if s == 201 else None
s, doc4 = api("POST", f"/orgs/{org_a}/documents", tok_b,
              {"title": "Intl concept paper", "doc_type": "concept_paper", "project_id": pid4}, org=org_a)
did4 = (doc4.get("data") or {}).get("id") if s == 201 else None
s, d4 = api("GET", f"/orgs/{org_a}/documents/{did4}", tok_a, org=org_a)
check("webinar_intl linked doc gets RFP step",
      s == 200 and any("RFP" in x["label"] for x in d4.get("signatory_steps", [])),
      f"{s} {str(d4.get('signatory_steps'))[:140]}")
s, doc5 = api("POST", f"/orgs/{org_a}/documents", tok_b,
              {"title": "Unlinked concept paper", "doc_type": "concept_paper"}, org=org_a)
did5 = (doc5.get("data") or {}).get("id") if s == 201 else None
s, d5 = api("GET", f"/orgs/{org_a}/documents/{did5}", tok_a, org=org_a)
check("unlinked doc gets no conditional steps",
      s == 200 and not any("RFP" in x["label"] or "Marketing" in x["label"]
                           for x in d5.get("signatory_steps", [])),
      f"{s} {str(d5.get('signatory_steps'))[:140]}")

# flag-gated step via stored document flags — and attach_chain respects them
s, doc6 = api("POST", f"/orgs/{org_a}/documents", tok_b,
              {"title": "Merch letter", "doc_type": "letter", "flags": {"has_merch": True}}, org=org_a)
did6 = (doc6.get("data") or {}).get("id") if s == 201 else None
check("document persists flags",
      s == 201 and (doc6.get("data") or {}).get("flags", {}).get("has_merch") is True,
      f"{s} {str(doc6)[:140]}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did6}/attach-chain", tok_b, {"chain_id": ch_id}, org=org_a)
check("attach-chain routes unrouted doc", s == 200, f"{s}")
s, d6 = api("GET", f"/orgs/{org_a}/documents/{did6}", tok_a, org=org_a)
check("attach_chain uses stored doc.flags (Marketing in, RFP out)",
      s == 200 and any("Marketing" in x["label"] for x in d6.get("signatory_steps", []))
      and not any("RFP" in x["label"] for x in d6.get("signatory_steps", [])),
      f"{s} {str(d6.get('signatory_steps'))[:140]}")
s, r = api("POST", f"/orgs/{org_a}/documents/{did6}/attach-chain", tok_b, {"chain_id": ch_id}, org=org_a)
check("second attach-chain -> 409 CHAIN_EXISTS", s == 409 and r["error"]["code"] == "CHAIN_EXISTS", f"{s}")

# chain delete is safe with routed docs (document steps have no FK back)
s, r = api("DELETE", f"/orgs/{org_a}/signatory-chains/{ch_id}", tok_b, org=org_a)
check("officer cannot delete chain", s == 403, f"{s}")
s, r = api("DELETE", f"/orgs/{org_a}/signatory-chains/{ch_id}", tok_a, org=org_a)
check("owner deletes chain", s == 200, f"{s}")
s, d = api("GET", f"/orgs/{org_a}/documents/{did}", tok_a, org=org_a)
check("routed doc unaffected by chain delete", s == 200 and len(d.get("signatory_steps", [])) >= 2, f"{s}")

# ── 8. Contacts + audit ─────────────────────────────────────────────────
s, r = api("POST", f"/orgs/{org_a}/contacts", tok_a, {"label": "Concept papers", "value": "SAS office, 2nd floor"}, org=org_a)
check("contact added", s == 201, f"{s}")
s, r = api("GET", f"/orgs/{org_a}/audit", tok_a, org=org_a)
check("audit log populated", s == 200 and len(r["data"]) >= 8, f"{s} n={len(r.get('data',[]))}")
s, r = api("GET", f"/orgs/{org_a}/audit", tok_b, org=org_a)
check("audit denied to officer", s == 403, f"{s}")

# ── 9. Tenant isolation hard stop ───────────────────────────────────────
# org_c was created in §6b (tok_c is its owner, member of org_a)
s, r = api("GET", f"/orgs/{org_c}/documents", tok_a, org=org_c)
check("org A member cannot read org B documents", s in (403, 404), f"{s}")

# ── 10. Self-service profile + account deletion ─────────────────────────
s, r = api("PATCH", "/me", tok_b, {"display_name": "Smoke Renamed"})
check("PATCH /me renames", s == 200 and r["data"]["display_name"] == "Smoke Renamed", f"{s} {str(r)[:120]}")
s, ms = api("GET", f"/orgs/{org_a}/members", tok_a, org=org_a)
check("roster reflects rename", any(m["display_name"] == "Smoke Renamed" for m in ms.get("data", [])), f"{s}")

# privilege escalation through /me must be impossible
s, r = api("PATCH", "/me", tok_b, {"role": "owner"})
check("PATCH /me rejects role field", s == 422, f"{s} {str(r)[:120]}")
s, ms = api("GET", f"/orgs/{org_a}/members", tok_a, org=org_a)
check("role still officer after attempt",
      next(m["role"] for m in ms["data"] if m["user_id"] == uid_b) == "officer")

s, r = api("PATCH", "/me", tok_b, {"avatar_url": "https://evil.example.com/x.jpg"})
check("PATCH /me rejects foreign avatar URL", s == 422, f"{s}")

s, r = api("POST", "/me/avatar/sign", tok_b, {"mime": "application/x-msdownload", "byte_size": 10})
check("avatar sign rejects bad mime", s == 422, f"{s}")
s, sign = api("POST", "/me/avatar/sign", tok_b, {"mime": "image/png", "byte_size": 68})
check("avatar sign mints upload+public URL",
      s == 201 and sign.get("upload_url") and sign.get("public_url"), f"{s} {str(sign)[:120]}")
if s == 201:
    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c489") + b"\x00" * 40
    req = urllib.request.Request(sign["upload_url"], data=png, method="PUT")
    req.add_header("Content-Type", "image/png")
    try:
        urllib.request.urlopen(req); up_ok = True
    except Exception as e:
        up_ok = False; print("   avatar upload err:", str(e)[:120])
    check("avatar bytes PUT to storage", up_ok)
    s, r = api("PATCH", "/me", tok_b, {"avatar_url": sign["public_url"]})
    check("avatar_url saved", s == 200 and r["data"]["avatar_url"] == sign["public_url"], f"{s} {str(r)[:140]}")
    s, ms = api("GET", f"/orgs/{org_a}/members", tok_a, org=org_a)
    check("roster serves avatar_url",
          next(m["avatar_url"] for m in ms["data"] if m["user_id"] == uid_b) == sign["public_url"])

# delete: sole owner blocked, member allowed + banned
s, r = api("DELETE", "/me", tok_a)
check("sole owner delete blocked (409)", s == 409 and r["error"]["code"] == "SOLE_OWNER", f"{s} {str(r)[:140]}")

s, r = api("DELETE", "/me", tok_b)
check("member account deleted", s == 200 and r["data"]["deleted"], f"{s} {str(r)[:120]}")
s, ms = api("GET", f"/orgs/{org_a}/members", tok_a, org=org_a)
check("membership flipped to removed",
      next(m["status"] for m in ms["data"] if m["user_id"] == uid_b) == "removed")
check("profile anonymized",
      next(m["display_name"] for m in ms["data"] if m["user_id"] == uid_b) == "Former member")
# ban blocks NEW sessions; the already-issued JWT may still verify until expiry
s, r = api("GET", f"/orgs/{org_a}/documents", tok_b, org=org_a)
check("removed member loses org access", s in (403, 404), f"{s}")
s, r = call("POST", f"{SUPA}/auth/v1/token?grant_type=password", ANON,
            {"email": EMAIL_B, "password": PASS})
check("banned user cannot sign in", s >= 400, f"{s} {str(r)[:120]}")

# ── 11. Member-removal guards + org archive ─────────────────────────────
# last-owner protection: the only owner can't be removed or demoted
s, r = api("PATCH", f"/orgs/{org_a}/members/{uid_a}", tok_a, {"status": "removed"}, org=org_a)
check("sole owner can't be removed", s == 409 and r["error"]["code"] == "SOLE_OWNER", f"{s} {str(r)[:140]}")

# ordinary member removal still works (uid_c is a member of org_a)
s, r = api("PATCH", f"/orgs/{org_a}/members/{uid_c}", tok_a, {"status": "removed"}, org=org_a)
check("owner removes member", s == 200 and r["data"]["status"] == "removed", f"{s} {str(r)[:120]}")

# archive: org vanishes for members, leaves /me, restore is admin-only
s, r = api("POST", f"/orgs/{org_a}/archive", tok_a, {}, org=org_a)
check("owner archives org", s == 200 and r["data"].get("archived_at"), f"{s} {str(r)[:120]}")
s, r = api("GET", f"/orgs/{org_a}", tok_c, org=org_a)
check("archived org 404s even for its removed member", s == 404, f"{s}")
s, me_a = api("GET", "/me", tok_a)
check("archived org leaves memberships",
      all(m["org_id"] != org_a for m in me_a["memberships"]) and not me_a.get("is_admin"))
s, r = api("POST", f"/admin/orgs/{org_a}/restore", tok_a)
check("non-admin can't restore", s == 403, f"{s}")
s, r = api("GET", "/admin/orgs", tok_c)
check("/admin/orgs blocked for non-admin", s == 403, f"{s}")

print(f"\n=== {len(ok)} passed, {len(fail)} failed ===")
if fail: print("FAILED:", fail); sys.exit(1)
