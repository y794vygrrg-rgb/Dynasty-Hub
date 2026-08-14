const LEAGUE_ID="1327325072385409024";
const API="https://api.sleeper.app/v1";
const MARKET_URL="https://www.dynastydealer.com/api/player-values";
const CACHE_MS=86400000;

const S={tab:"overview",league:null,users:[],rosters:[],drafts:[],picks:[],trades:[],players:{},market:{},tradedPicks:[]};
const $=s=>document.querySelector(s);
const esc=x=>String(x??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=x=>x==null?"—":Number(x).toLocaleString(undefined,{maximumFractionDigits:0});
const pct=x=>`${Math.round(x)}%`;

async function getJSON(url){const r=await fetch(url);if(!r.ok)throw Error(`${r.status} ${r.statusText}`);return r.json()}
async function cached(key,url){try{const x=JSON.parse(localStorage.getItem(key)||"null");if(x&&Date.now()-x.t<CACHE_MS)return x.d}catch{}const d=await getJSON(url);try{localStorage.setItem(key,JSON.stringify({t:Date.now(),d}))}catch{}return d}

function user(id){const x=S.users.find(u=>String(u.user_id)===String(id));return x?.display_name||x?.username||`User ${id}`}
function roster(id){return S.rosters.find(r=>Number(r.roster_id)===Number(id))}
function team(id){return user(roster(id)?.owner_id)||`Roster ${id}`}
function player(id){return S.players[String(id)]||{}}
function market(id){return S.market[String(id)]||{}}
function value(id){return Number(market(id).current_value??market(id).value??0)}
function age(id){const a=Number(market(id).age??player(id).age);return Number.isFinite(a)&&a>0?a:null}
function pos(id){return String(market(id).position||player(id).position||"").toUpperCase()}
function rank(id){const r=roster(id);return Number(r?.settings?.rank||99)}
function wins(id){return Number(roster(id)?.settings?.wins||0)}
function losses(id){return Number(roster(id)?.settings?.losses||0)}

function rosterValue(r){return (r?.players||[]).reduce((n,id)=>n+value(id),0)}
function positionalValues(r){
  const out={QB:0,RB:0,WR:0,TE:0};
  for(const id of r?.players||[]){const p=pos(id);if(out[p]!=null)out[p]+=value(id)}
  return out;
}
function teamDirection(r){
  const pv=positionalValues(r);
  const ages=(r?.players||[]).map(age).filter(Boolean);
  const avg=ages.length?ages.reduce((a,b)=>a+b,0)/ages.length:26;
  const rv=rosterValue(r);
  const standings=rank(r.roster_id);
  if((standings<=4&&rv>25000)||(avg<25.5&&rv>22000))return "contender";
  if(standings>=9||avg>=27.2)return "rebuild";
  return "middle";
}
function pickValue(p){
  const round=Number(p.round)||4;
  const base={1:5000,2:2800,3:1500,4:800}[round]||500;
  const years=Math.max(0,(Number(p.season)||new Date().getFullYear())-new Date().getFullYear());
  return Math.round(base*Math.pow(.82,years));
}
function pickLabel(p){return `${p.season} ${["","1st","2nd","3rd","4th"][Number(p.round)]||p.round+"th"}`}
function gradeLetter(score){
  return score>=93?"A+":score>=88?"A":score>=83?"A-":score>=78?"B+":score>=72?"B":score>=66?"B-":score>=60?"C+":score>=54?"C":score>=48?"C-":score>=40?"D":"F";
}
function tradeSides(tx){
  const sides={};
  for(const rid of tx.roster_ids||[])sides[rid]={received:[],sent:[],valueReceived:0,valueSent:0};
  // Sleeper trade adds are assets received by the mapped roster.
  for(const [pid,rid] of Object.entries(tx.adds||{})){
    if(!sides[rid])continue;
    sides[rid].received.push({type:"player",id:pid,name:player(pid).full_name||market(pid).name||pid,value:value(pid),age:age(pid),pos:pos(pid)});
  }
  for(const [pid,rid] of Object.entries(tx.drops||{})){
    if(!sides[rid])continue;
    sides[rid].sent.push({type:"player",id:pid,name:player(pid).full_name||market(pid).name||pid,value:value(pid),age:age(pid),pos:pos(pid)});
  }
  for(const p of tx.draft_picks||[]){
    const newOwner=p.owner_id??p.roster_id;
    const oldOwner=p.previous_owner_id;
    const asset={type:"pick",id:null,name:pickLabel(p),value:pickValue(p),age:null,pos:"PICK",pick:p};
    if(newOwner!=null&&sides[newOwner])sides[newOwner].received.push(asset);
    if(oldOwner!=null&&sides[oldOwner])sides[oldOwner].sent.push(asset);
  }
  for(const s of Object.values(sides)){
    s.valueReceived=s.received.reduce((n,a)=>n+a.value,0);
    s.valueSent=s.sent.reduce((n,a)=>n+a.value,0);
  }
  return sides;
}
function sideContext(rid,side){
  const r=roster(rid), dir=teamDirection(r), pv=positionalValues(r);
  const receivedPos={QB:0,RB:0,WR:0,TE:0};
  side.received.forEach(a=>{if(receivedPos[a.pos]!=null)receivedPos[a.pos]+=a.value});
  let needBonus=0;
  const total=Object.values(pv).reduce((a,b)=>a+b,0)||1;
  for(const p of ["QB","RB","WR","TE"]){
    const share=pv[p]/total;
    if(share<.16&&receivedPos[p]>0)needBonus+=5;
    else if(share>.38&&receivedPos[p]>pv[p]*.2)needBonus-=3;
  }
  let directionBonus=0;
  const recPlayers=side.received.filter(a=>a.type==="player"&&a.age);
  if(dir==="rebuild"){
    const young=recPlayers.filter(a=>a.age<=24).reduce((n,a)=>n+a.value,0);
    const old=recPlayers.filter(a=>a.age>=28).reduce((n,a)=>n+a.value,0);
    directionBonus=Math.max(-6,Math.min(8,(young-old)/Math.max(side.valueReceived,1)*14));
  }else if(dir==="contender"){
    const winNow=recPlayers.filter(a=>a.age>=25&&a.age<=29).reduce((n,a)=>n+a.value,0);
    const future=recPlayers.filter(a=>a.age<=23).reduce((n,a)=>n+a.value,0);
    directionBonus=Math.max(-6,Math.min(8,(winNow-future)/Math.max(side.valueReceived,1)*12));
  }
  const avgAge=recPlayers.length?recPlayers.reduce((n,a)=>n+a.age,0)/recPlayers.length:null;
  return {dir,pv,needBonus,directionBonus,avgAge};
}
function scoreSide(rid,side,other){
  const ctx=sideContext(rid,side);
  const received=side.valueReceived||1,sent=side.valueSent||1;
  const marketEdge=Math.max(-18,Math.min(18,(received-sent)/Math.max(received,sent)*28));
  const fit=ctx.needBonus+ctx.directionBonus;
  const volumeBonus=received>sent?2:0;
  const score=Math.max(0,Math.min(100,70+marketEdge+fit+volumeBonus));
  return {...ctx,score,grade:gradeLetter(score)};
}
function tradeSummary(tx){
  const entries=Object.entries(tradeSides(tx));
  if(entries.length<2)return null;
  const scored=entries.map(([rid,s])=>[rid,s,scoreSide(rid,s,entries)]);
  scored.sort((a,b)=>b[2].score-a[2].score);
  return scored;
}
function assetsHTML(arr){
  if(!arr.length)return `<span class="muted">None</span>`;
  return arr.map(a=>`<div class="asset"><span>${esc(a.name)}${a.pos&&a.pos!=="PICK"?` <small>${esc(a.pos)}</small>`:""}</span><strong>${fmt(a.value)}</strong></div>`).join("");
}

async function sync(){
  $("#sync").disabled=true;$("#status").textContent="Syncing Sleeper league data…";
  try{
    S.league=await getJSON(`${API}/league/${LEAGUE_ID}`);
    S.users=await getJSON(`${API}/league/${LEAGUE_ID}/users`);
    S.rosters=await getJSON(`${API}/league/${LEAGUE_ID}/rosters`);
    S.drafts=await getJSON(`${API}/league/${LEAGUE_ID}/drafts`);
    S.tradedPicks=await getJSON(`${API}/league/${LEAGUE_ID}/traded_picks`);
    S.players=await cached("dhq_players",`${API}/players/nfl`);
    S.market={};
    try{
      const raw=await cached("dhq_market",MARKET_URL);
      for(const x of (Array.isArray(raw)?raw:(raw.players||[])))if(x.sleeper_id!=null)S.market[String(x.sleeper_id)]=x;
    }catch{}
    S.picks=[];
    for(const d of S.drafts)try{S.picks.push(...await getJSON(`${API}/draft/${d.draft_id}/picks`))}catch{}
    S.trades=[];const seen=new Set();
    for(let w=1;w<=18;w++)try{
      for(const t of await getJSON(`${API}/league/${LEAGUE_ID}/transactions/${w}`)||[]){
        if(t.type==="trade"&&!seen.has(t.transaction_id)){seen.add(t.transaction_id);S.trades.push(t)}
      }
    }catch{}
    S.trades.sort((a,b)=>(a.created||0)-(b.created||0));
    $("#status").textContent=`Synced ${new Date().toLocaleString()} • Market: ${Object.keys(S.market).length?"live":"unavailable"}`;
    render();
  }catch(e){$("#status").textContent=`Sync failed: ${e.message}`}
  $("#sync").disabled=false;
}

function overview(){
  const vals=S.rosters.map(rosterValue);
  return `<div class="grid">
    <div class="card"><h3>Teams</h3><div class="metric">${S.rosters.length}</div></div>
    <div class="card"><h3>Trades</h3><div class="metric">${S.trades.length}</div></div>
    <div class="card"><h3>Draft Picks</h3><div class="metric">${S.picks.length}</div></div>
    <div class="card"><h3>Market Assets</h3><div class="metric">${Object.keys(S.market).length.toLocaleString()}</div></div>
  </div>
  <div class="panel"><h2>Roster Market Values & Direction</h2>
  <table class="table"><tr><th>Team</th><th>Value</th><th>Record</th><th>Direction</th></tr>
  ${S.rosters.slice().sort((a,b)=>rosterValue(b)-rosterValue(a)).map(r=>`<tr><td>${esc(team(r.roster_id))}</td><td>${fmt(rosterValue(r))}</td><td>${wins(r.roster_id)}-${losses(r.roster_id)}</td><td><span class="tag">${teamDirection(r)}</span></td></tr>`).join("")}</table></div>`;
}

function trades(){
  if(!S.trades.length)return `<div class="panel"><div class="empty">No trades found. Sync the league.</div></div>`;
  return `<div class="panel"><h2>Contextual Trade Grades</h2>
  <div class="notice">These are V2.1 contextual grades using current market values plus roster need, team direction and age. They are <b>not</b> frozen historical grades; historical market-at-trade-date data is shown separately when available.</div>
  ${S.trades.slice().reverse().map(tx=>{
    const scored=tradeSummary(tx); if(!scored)return "";
    const date=tx.created?new Date(tx.created).toLocaleDateString():"Unknown date";
    return `<div class="trade-card">
      <div class="trade-head"><strong>${date}</strong><span class="tag">Historical market: unavailable</span></div>
      <div class="sides">
      ${scored.map(([rid,side,sc])=>`<div class="side">
        <h3>${esc(team(rid))} <span class="grade ${sc.grade.replace("+","p").replace("-","m")}">${sc.grade}</span></h3>
        <div class="muted">${sc.dir} • contextual score ${Math.round(sc.score)}/100</div>
        <p><b>Received</b></p>${assetsHTML(side.received)}
        <p><b>Sent</b></p>${assetsHTML(side.sent)}
        <div class="bar"><i style="width:${Math.max(0,Math.min(100,sc.score))}%"></i></div>
        <p class="muted">Need ${sc.needBonus>=0?"+":""}${sc.needBonus.toFixed(1)} • Direction ${sc.directionBonus>=0?"+":""}${sc.directionBonus.toFixed(1)}</p>
      </div>`).join("")}</div>
    </div>`;
  }).join("")}</div>`;
}

function draft(){
  if(!S.picks.length)return `<div class="panel"><div class="empty">No draft picks found.</div></div>`;
  return `<div class="panel"><h2>Draft History</h2><table class="table"><tr><th>Pick</th><th>Manager</th><th>Player</th><th>Position</th><th>Current Market</th></tr>
  ${S.picks.slice().sort((a,b)=>(a.pick_no||0)-(b.pick_no||0)).map(p=>`<tr><td>${p.pick_no??"—"}</td><td>${esc(team(p.roster_id))}</td><td>${esc(player(p.player_id).full_name||market(p.player_id).name||p.player_id)}</td><td>${esc(pos(p.player_id))}</td><td>${fmt(value(p.player_id))}</td></tr>`).join("")}</table></div>`;
}
function rosters(){
  return `<div class="grid">${S.rosters.map(r=>`<div class="card"><h3>${esc(team(r.roster_id))}</h3><div class="metric">${fmt(rosterValue(r))}</div><div class="muted">${(r.players||[]).length} players • ${teamDirection(r)}</div></div>`).join("")}</div>`;
}
function history(){
  return `<div class="panel"><h2>League History</h2><p>Current league ID: ${LEAGUE_ID}</p><p>Previous league ID: ${esc(S.league?.previous_league_id||"None")}</p><p class="muted">The Sleeper previous-league chain is retained for the historical engine. Recursive prior-season ingestion is the next data expansion.</p></div>`;
}
function grades(){
  return `<div class="panel"><h2>V2.1 Trade Grading Model</h2>
  <p><b>Market value:</b> measures the asset-value edge.</p>
  <p><b>Roster fit:</b> rewards assets at positions where a roster is relatively weak.</p>
  <p><b>Team direction:</b> rebuilders receive more credit for youth/future value; contenders receive more credit for near-term production windows.</p>
  <p><b>Age:</b> incorporated into the direction adjustment.</p>
  <p><b>Historical integrity:</b> current values are never mislabeled as trade-date values.</p>
  <p class="muted">Next: historical market snapshots, pick-specific value curves, positional scarcity calibration, and retrospective outcomes.</p>
  </div>`;
}
function render(){
  const views={overview,trades,draft,rosters,history,grades};
  $("#meta").textContent=`${S.league?.name||"Sleeper League"} • ${S.rosters.length||0} teams • 0.5 PPR • 1QB • No TEP`;
  document.querySelectorAll("#tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===S.tab));
  $("#app").innerHTML=views[S.tab]();
}
$("#sync").onclick=sync;
$("#tabs").onclick=e=>{const b=e.target.closest("button[data-tab]");if(b){S.tab=b.dataset.tab;render()}};
render();sync();