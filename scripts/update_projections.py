import json, os, re, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SEASON=2026
LEAGUE_ID="1327325072385409024"
KEY=os.environ["FANTASYPROS_API_KEY"]
BASE="https://api.fantasypros.com/public/v2/json"
SLEEPER_BASE="https://api.sleeper.app/v1"

def get_json(url,headers=None):
    req=urllib.request.Request(url,headers=headers or {})
    with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)

def norm(s):
    s=unicodedata.normalize("NFKD",str(s or "")).encode("ascii","ignore").decode().lower()
    s=s.replace(".","").replace("'","").replace("-"," ")
    s=re.sub(r"\b(jr|sr|ii|iii|iv)\b","",s)
    return re.sub(r"[^a-z0-9]+","",s)

def tnorm(s):
    s=str(s or "").upper()
    return {"JAX":"JAC","WSH":"WAS","LA":"LAR","OAK":"LV"}.get(s,s)

sleepers=get_json(f"{SLEEPER_BASE}/players/nfl")
rosters=get_json(f"{SLEEPER_BASE}/league/{LEAGUE_ID}/rosters")
rostered_ids=set()
for r in rosters:
    for sid in (r.get("players") or []):
        rostered_ids.add(str(sid))

exact={}; namepos={}
for sid,p in sleepers.items():
    nm=p.get("full_name") or p.get("search_full_name") or ""
    ps=str(p.get("position") or "").upper()
    exact[(norm(nm),tnorm(p.get("team")),ps)]=str(sid)
    namepos.setdefault((norm(nm),ps),[]).append((str(sid),tnorm(p.get("team"))))

def sleeper_id(name,team,pos):
    pos=str(pos or "").upper()
    sid=exact.get((norm(name),tnorm(team),pos))
    if sid:return sid
    c=namepos.get((norm(name),pos),[])
    if len(c)==1:return c[0][0]
    team=tnorm(team); m=[sid for sid,t in c if t==team and team]
    return m[0] if len(m)==1 else None

headers={"x-api-key":KEY}
merged={}

# Seed every fantasy-relevant rostered player so the output is league-specific.
for sid in rostered_ids:
    p=sleepers.get(sid,{})
    pos=str(p.get("position") or "").upper()
    if pos not in {"QB","RB","WR","TE"}:continue
    merged[sid]={
        "sleeper_id":sid,
        "name":p.get("full_name") or sid,
        "team":p.get("team"),
        "position":pos,
        "league_rostered":True
    }

# Explicit preseason projections.
for position in ["QB","RB","WR","TE"]:
    q=urllib.parse.urlencode({"position":position,"week":0})
    d=get_json(f"{BASE}/nfl/{SEASON}/projections?{q}",headers)
    for p in d.get("players",[]):
        sid=sleeper_id(p.get("name"),p.get("team_id"),p.get("position_id") or position)
        if sid not in merged:continue
        stats=p.get("stats") or {}
        if isinstance(stats,list):stats=stats[0] if stats else {}
        pts=stats.get("points_half")
        if pts is not None:
            try:merged[sid]["points_half"]=float(pts)
            except:pass

# Broad ECR feed.
d=get_json(f"{BASE}/nfl/players?ecr=included&show=pos_rank",headers)
for p in d.get("players",[]):
    sid=sleeper_id(p.get("player_name") or p.get("name"),p.get("team_id"),p.get("position_id"))
    if sid not in merged:continue
    rank=p.get("rank_ecr_half")
    if rank in (None,"",0,"0"):rank=p.get("rank_ecr")
    try:
        if rank is not None and float(rank)>0:merged[sid]["rank_ecr"]=float(rank)
    except:pass
    pr=p.get("rank_ecr_pos") or p.get("pos_rank")
    if pr is not None:merged[sid]["pos_rank"]=pr

# Add explicit data-confidence fields in the generated file.
for sid,x in merged.items():
    has_proj="points_half" in x
    has_ecr="rank_ecr" in x
    if has_proj and has_ecr:x["data_confidence"]="A"
    elif has_proj or has_ecr:x["data_confidence"]="B"
    else:x["data_confidence"]="C"

payload={
    "season":SEASON,
    "league_id":LEAGUE_ID,
    "scoring":"half_ppr",
    "source":"FantasyPros + Sleeper league-specific intelligence",
    "updated_at":datetime.now(timezone.utc).isoformat(),
    "players":list(merged.values()),
    "league_rostered_count":len(merged),
    "projected_count":sum("points_half" in x for x in merged.values()),
    "ranked_count":sum("rank_ecr" in x for x in merged.values()),
    "direct_coverage_count":sum(("points_half" in x or "rank_ecr" in x) for x in merged.values())
}
Path("data").mkdir(exist_ok=True)
Path("data/projections.json").write_text(json.dumps(payload,indent=2))
print(
    f"League pool {payload['league_rostered_count']}; "
    f"{payload['projected_count']} projections; "
    f"{payload['ranked_count']} ECR; "
    f"{payload['direct_coverage_count']} directly covered."
)
