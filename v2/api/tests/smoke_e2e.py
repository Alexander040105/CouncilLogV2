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

# ── 1. Create users (admin API → already confirmed) ─────────────────────
def ensure_user(email):
    s, r = call("POST", f"{SUPA}/auth/v1/admin/users", SERVICE,
                {"email": email, "password": PASS, "email_confirm": True})
    if s >= 400 and "already" not in json.dumps(r):
        print("admin create failed", s, r); sys.exit(1)
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

# owner mints invite → member redeems
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

s, r = api("POST", f"/orgs/{org_a}/attendance/no-tasks", tok_a, {}, org=org_a)
check("owner declares no-tasks", s == 201 and r["data"]["status"] == "declared_no_tasks", f"{s}")
s, r = api("GET", f"/orgs/{org_a}/attendance", tok_a, org=org_a)
check("attendance list + unaccounted", s == 200 and "unaccounted_member_ids" in r, f"{s}")
s, r = api("GET", f"/orgs/{org_a}/attendance/summary", tok_a, org=org_a)
check("attendance summary", s == 200 and "data" in r, f"{s} {str(r)[:120]}")

# photo sign → upload (tiny png) → attach → view url
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
s, r = api("POST", f"/orgs/{org_a}/documents/{did}/movements", tok_a,
           {"location_text": "SD office inbox tray"}, org=org_a)
check("movement logged (append-only)", s == 201, f"{s}")
step = d["signatory_steps"][0]
s, r = api("POST", f"/orgs/{org_a}/documents/{did}/steps/{step['id']}", tok_b, {"status": "signed"}, org=org_a)
check("signatory step signed", s == 200, f"{s}")
s, d = api("GET", f"/orgs/{org_a}/documents/{did}", tok_a, org=org_a)
check("current_location = SD office", d.get("current_location") == "SD office inbox tray")

# ── 8. Contacts + audit ─────────────────────────────────────────────────
s, r = api("POST", f"/orgs/{org_a}/contacts", tok_a, {"label": "Concept papers", "value": "SAS office, 2nd floor"}, org=org_a)
check("contact added", s == 201, f"{s}")
s, r = api("GET", f"/orgs/{org_a}/audit", tok_a, org=org_a)
check("audit log populated", s == 200 and len(r["data"]) >= 8, f"{s} n={len(r.get('data',[]))}")
s, r = api("GET", f"/orgs/{org_a}/audit", tok_b, org=org_a)
check("audit denied to officer", s == 403, f"{s}")

# ── 9. Tenant isolation hard stop ───────────────────────────────────────
s, r = api("GET", f"/orgs/{org_a}/documents", tok_c, org=org_a)
# tok_c was approved as member earlier! create a real outsider check:
s, r2 = api("POST", "/orgs", tok_c, {"name": "Other Dept", "slug": f"{SLUG}-other", "school_year_label": "SY 2025-2026"})
org_c = r2.get("id") or (r2.get("data") or {}).get("id")
s, r = api("GET", f"/orgs/{org_c}/documents", tok_a, org=org_c)
check("org A member cannot read org B documents", s in (403, 404), f"{s}")

print(f"\n=== {len(ok)} passed, {len(fail)} failed ===")
if fail: print("FAILED:", fail); sys.exit(1)
