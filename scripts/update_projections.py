import json, os, re, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SEASON=2026
KEY=os.environ["FANTASYPROS_API_KEY"]
BASE="https://api.fantasypros.com/public/v2/json"
SLEEPER="https://api.sleeper.app/v1/players/nfl"

def get_json(url,headers=None):
    req=urllib.request.Request(url,headers=headers or {})
    with urllib.request.urlopen(req,timeout=90) as r:return json.load(r)

def norm(s):
    s=unicodedata.normalize("NFKD",str(s or "")).encode("ascii","ignore").decode().lower()
    s=s.replace(".","").replace("'","").replace("-"," ")
    s=re.sub(r"\b(jr|sr|ii|iii|iv)\b","",s)
    return re.sub(r"[^a-z0-9]+","",s)

def tnorm(s):
    return {"JAX":"JAC","WSH":"WAS","LA":"LAR","OAK":"LV"}.get(str(s or "").upper(),str(s or "").upper())

sleepers=get_json(SLEEPER)
exact={}; namepos={}
for sid,p in sleepers.items():
    nm=p.get("full_name") or p.get("search_full_name") or ""
    ps=str(p.get("position") or "").upper()
    exact[(norm(nm),tnorm(p.get("team")),ps)]=str(sid)
    namepos.setdefault((norm(nm),ps),[]).append((str(sid),tnorm(p.get("team"))))

def sleeper_id(name,team,pos):
    sid=exact.get((norm(name),tnorm(team),str(pos or "").upper()))
    if sid:return sid
    c=namepos.get((norm(name),str(pos or "").upper()),[])
    return c[0][0] if len(c)==1 else None

headers={"x-api-key":KEY}
merged={}
unmatched=[]

# A) Explicit preseason point projections.
for position in ["QB","RB","WR","TE"]:
    q=urllib.parse.urlencode({"position":position,"week":0})
    d=get_json(f"{BASE}/nfl/{SEASON}/projections?{q}",headers)
    for p in d.get("players",[]):
        name=p.get("name"); team=p.get("team_id"); pos=p.get("position_id") or position
        stats=p.get("stats") or {}
        if isinstance(stats,list): stats=stats[0] if stats else {}
        points=stats.get("points_half")
        sid=sleeper_id(name,team,pos)
        if sid:
            merged.setdefault(sid,{"sleeper_id":sid,"name":name,"team":team,"position":pos})
            if points is not None: merged[sid]["points_half"]=float(points)
            merged[sid]["fpid"]=p.get("fpid")
        else: unmatched.append({"source":"projection","name":name,"team":team,"position":pos})

# B) Full half-PPR preseason ECR. This provides much broader coverage than the
# limited point-projection feed for lower-tier starters and bench players.
q=urllib.parse.urlencode({"position":"ALL","scoring":"HALF","week":0,"type":"PRESEASON"})
rankings=get_json(f"{BASE}/nfl/{SEASON}/consensus-rankings?{q}",headers)
for p in rankings.get("players",[]):
    name=p.get("player_name") or p.get("name")
    team=p.get("player_team_id") or p.get("team_id")
    pos=p.get("player_position_id") or p.get("position_id")
    sid=sleeper_id(name,team,pos)
    if not sid:
        unmatched.append({"source":"ecr","name":name,"team":team,"position":pos})
        continue
    x=merged.setdefault(sid,{"sleeper_id":sid,"name":name,"team":team,"position":pos})
    rank=p.get("rank_ecr")
    if rank is not None:
        try:x["rank_ecr"]=float(rank)
        except:pass
    if p.get("pos_rank") is not None:x["pos_rank"]=p.get("pos_rank")
    x["fpid"]=x.get("fpid") or p.get("player_id")

payload={
 "season":SEASON,"scoring":"half_ppr",
 "source":"FantasyPros Public API â preseason projections + HALF ECR",
 "updated_at":datetime.now(timezone.utc).isoformat(),
 "players":list(merged.values()),
 "projected_count":sum("points_half" in x for x in merged.values()),
 "ranked_count":sum("rank_ecr" in x for x in merged.values()),
 "unmatched_count":len(unmatched)
}
Path("data").mkdir(exist_ok=True)
Path("data/projections.json").write_text(json.dumps(payload,indent=2))
print(f"Mapped {len(payload['players'])} total: {payload['projected_count']} projections, {payload['ranked_count']} ECR rankings; {payload['unmatched_count']} unmatched.")
