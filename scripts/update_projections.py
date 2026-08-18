import json, os, re, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SEASON = 2026
KEY = os.environ["FANTASYPROS_API_KEY"]
FP_BASE = "https://api.fantasypros.com/public/v2/json"
SLEEPER_PLAYERS = "https://api.sleeper.app/v1/players/nfl"

def get_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii","ignore").decode()
    s = s.lower().replace(".", "").replace("'", "").replace("-", " ")
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)

def team_norm(s):
    aliases={"JAX":"JAC","WSH":"WAS","LA":"LAR","LV":"LV","OAK":"LV"}
    s=str(s or "").upper()
    return aliases.get(s,s)

sleeper = get_json(SLEEPER_PLAYERS)
index = {}
name_only = {}
for sid, p in sleeper.items():
    name = p.get("full_name") or p.get("search_full_name") or ""
    key = (norm(name), team_norm(p.get("team")), str(p.get("position") or "").upper())
    index[key] = sid
    name_only.setdefault((norm(name), str(p.get("position") or "").upper()), []).append((sid, team_norm(p.get("team"))))

out=[]
unmatched=[]
headers={"x-api-key":KEY}
for position in ["QB","RB","WR","TE"]:
    qs=urllib.parse.urlencode({"position":position,"week":0})
    data=get_json(f"{FP_BASE}/nfl/{SEASON}/projections?{qs}", headers=headers)
    rows=data.get("players") or data.get("data") or []
    for row in rows:
        # FantasyPros responses have player metadata plus one or more stats objects.
        name=row.get("name") or row.get("player_name") or row.get("player",{}).get("name")
        team=row.get("team_id") or row.get("team") or row.get("player",{}).get("team_id")
        pos=row.get("position_id") or row.get("position") or position
        stats=row.get("stats") or []
        stat=stats[0] if isinstance(stats,list) and stats else (stats if isinstance(stats,dict) else {})
        points=stat.get("points_half")
        if points is None:
            points=row.get("points_half")
        sid=index.get((norm(name),team_norm(team),str(pos).upper()))
        if not sid:
            candidates=name_only.get((norm(name),str(pos).upper()),[])
            if len(candidates)==1:
                sid=candidates[0][0]
        if sid and points is not None:
            out.append({
                "sleeper_id":str(sid),
                "name":name,
                "team":team,
                "position":pos,
                "points_half":float(points)
            })
        else:
            unmatched.append({"name":name,"team":team,"position":pos})

payload={
    "season":SEASON,
    "scoring":"half_ppr",
    "source":"FantasyPros Public API",
    "updated_at":datetime.now(timezone.utc).isoformat(),
    "players":out,
    "unmatched_count":len(unmatched)
}
Path("data").mkdir(exist_ok=True)
Path("data/projections.json").write_text(json.dumps(payload,indent=2))
print(f"Wrote {len(out)} mapped projections; {len(unmatched)} unmatched.")
