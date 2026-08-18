const LEAGUE_ID="1327325072385409024",API="https://api.sleeper.app/v1",MARKET_URL="https://www.dynastydealer.com/api/player-values",CACHE=86400000,HISTORY_MAX=8;
const S={tab:"overview",users:[],rosters:[],drafts:[],picks:[],trades:[],players:{},market:{},seasons:[],league:null};
const $=s=>document.querySelector(s),esc=x=>String(x??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])),fmt=x=>x==null?"—":Number(x).toLocaleString();
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const grade=s=>s>=93?"A+":s>=88?"A":s>=83?"A-":s>=78?"B+":s>=72?"B":s>=66?"B-":s>=60?"C+":s>=54?"C":s>=48?"C-":s>=40?"D":"F";
async function get(u){const r=await fetch(u);if(!r.ok)throw Error(r.status);return r.json()}
async function cache(k,u){try{let x=JSON.parse(localStorage.getItem(k)||"null");if(x&&Date.now()-x.t<CACHE)return x.d}catch{}let d=await get(u);try{localStorage.setItem(k,JSON.stringify({t:Date.now(),d}))}catch{}return d}
function player(id){return S.players[String(id)]||{}}
function market(id){return S.market[String(id)]||{}}
function value(id){return Number(market(id).current_value??market(id).value??0)}
function age(id){let a=Number(market(id).age??player(id).age);return a>0?a:null}
function pos(id){return String(market(id).position||player(id).position||"").toUpperCase()}
function user(id){let x=S.users.find(u=>String(u.user_id)===String(id));return x?.display_name||x?.username||`User ${id}`}
function roster(id){return S.rosters.find(r=>Number(r.roster_id)===Number(id))}
function rosterValue(r){return(r?.players||[]).reduce((n,id)=>n+value(id),0)}
function direction(r){
  let a=(r?.players||[]).map(age).filter(Boolean),avg=a.length?a.reduce((x,y)=>x+y,0)/a.length:26;
  let rv=rosterValue(r),rank=Number(r?.settings?.rank||99);
  if((rank<=4&&rv>25000)||(avg<25.5&&rv>22000))return"contender";
  if(rank>=9||avg>=27.2)return"rebuild";
  return"middle";
}
function pickValue(p){
  const base={1:5000,2:2800,3:1500,4:800}[Number(p.round)]||500;
  const y=Math.max(0,(Number(p.season)||2026)-2026);
  return Math.round(base*Math.pow(.82,y));
}
function pickName(p){
  const names={1:"1st",2:"2nd",3:"3rd",4:"4th"};
  return `${p.season} ${names[Number(p.round)]||`${p.round}th`}`;
}
function sides(tx){
  let s={};
  for(let r of tx.roster_ids||[])s[r]={received:[],sent:[],valueReceived:0,valueSent:0};
  for(let[pid,r]of Object.entries(tx.adds||{}))if(s[r])s[r].received.push({name:player(pid).full_name||market(pid).name||pid,type:"player",id:pid,value:value(pid),age:age(pid),pos:pos(pid)});
  for(let[pid,r]of Object.entries(tx.drops||{}))if(s[r])s[r].sent.push({name:player(pid).full_name||market(pid).name||pid,type:"player",id:pid,value:value(pid),age:age(pid),pos:pos(pid)});
  for(let p of tx.draft_picks||[]){
    let a={name:pickName(p),type:"pick",value:pickValue(p),pos:"PICK"};
    if(p.owner_id!=null&&s[p.owner_id])s[p.owner_id].received.push(a);
    if(p.previous_owner_id!=null&&s[p.previous_owner_id])s[p.previous_owner_id].sent.push(a);
  }
  for(let x of Object.values(s)){
    x.valueReceived=x.received.reduce((n,a)=>n+a.value,0);
    x.valueSent=x.sent.reduce((n,a)=>n+a.value,0);
  }
  return s;
}
function score(r,s){
  const rec=s.valueReceived||0,sent=s.valueSent||0,den=Math.max(rec,sent,1);
  const marketPct=(rec-sent)/den;
  const edge=clamp(marketPct*28,-18,18);
  const dir=direction(r);
  const pv={QB:0,RB:0,WR:0,TE:0};
  for(let id of r?.players||[]){let p=pos(id);if(pv[p]!=null)pv[p]+=value(id)}
  const rp={QB:0,RB:0,WR:0,TE:0};
  s.received.forEach(a=>{if(rp[a.pos]!=null)rp[a.pos]+=a.value});
  let need=0,total=Object.values(pv).reduce((a,b)=>a+b,0)||1;
  for(let p of Object.keys(pv)){
    let sh=pv[p]/total;
    if(sh<.16&&rp[p]>0)need+=5;
    else if(sh>.38&&rp[p]>pv[p]*.2)need-=3;
  }
  const recp=s.received.filter(a=>a.type==="player"&&a.age);
  let adj=0;
  if(dir==="rebuild"){
    let y=recp.filter(a=>a.age<=24).reduce((n,a)=>n+a.value,0);
    let o=recp.filter(a=>a.age>=28).reduce((n,a)=>n+a.value,0);
    adj=clamp((y-o)/Math.max(rec,1)*14,-6,8);
  }else if(dir==="contender"){
    let w=recp.filter(a=>a.age>=25&&a.age<=29).reduce((n,a)=>n+a.value,0);
    let f=recp.filter(a=>a.age<=23).reduce((n,a)=>n+a.value,0);
    adj=clamp((w-f)/Math.max(rec,1)*12,-6,8);
  }
  const volume=rec>sent?2:rec<sent?-1:0;
  const packageAdj=s.received.length>=2&&s.sent.length<=1?1:0;
  const sc=clamp(70+edge+need+adj+volume+packageAdj,0,100);
  return{sc,grade:grade(sc),edge,need,adj,dir,volume,packageAdj,marketPct};
}
function assetHTML(a){
  return a.length?a.map(x=>`<div class="asset"><span>${esc(x.name)} ${x.pos&&x.pos!=="PICK"?`<small>${x.pos}</small>`:""}</span><b>${fmt(x.value)}</b></div>`).join(""):"<span class=muted>None</span>";
}
function reason(c){
  const parts=[];

  if(c.edge>=8) parts.push(`Strong market-value win (+${c.edge.toFixed(1)} grade points)`);
  else if(c.edge>=3) parts.push(`Positive market-value edge (+${c.edge.toFixed(1)} grade points)`);
  else if(c.edge<=-8) parts.push(`Significant market-value premium paid (${c.edge.toFixed(1)} grade points)`);
  else if(c.edge<=-3) parts.push(`Small market-value premium paid (${c.edge.toFixed(1)} grade points)`);
  else parts.push(`Near market-value neutral (${c.edge>=0?"+":""}${c.edge.toFixed(1)} grade points)`);

  if(c.need>=5) parts.push("fills a clear positional weakness");
  else if(c.need>=2) parts.push("improves positional balance");
  else if(c.need<=-2) parts.push("adds to a position that was already relatively strong");

  if(c.adj>=4){
    parts.push(c.dir==="rebuild"
      ?"meaningfully improves the team's age curve for a rebuild"
      :"adds assets that fit the contender window");
  }else if(c.adj>=2){
    parts.push(c.dir==="rebuild"
      ?"slightly improves the team's age curve"
      :"fits the team's competitive window");
  }else if(c.adj<=-4){
    parts.push(c.dir==="rebuild"
      ?"works against the rebuilding timeline"
      :"creates a notable age-profile concern");
  }else if(c.adj<=-2){
    parts.push("has a modest age-profile drawback");
  }

  if(c.volume>0) parts.push("also receives slightly more total asset value");
  if(c.packageAdj>0) parts.push("gets a small package-structure bonus");

  return parts.join(" • ")+".";
}
function tradePower(){
  const map={};
  for(const t of S.trades){
    const z=sides(t);
    for(const [rid,x] of Object.entries(z)){
      const r=t._season?.rosters.find(q=>Number(q.roster_id)===Number(rid))||roster(rid);
      const c=score(r,x);
      const name=t._season?histUser(t._season,rid):user(r?.owner_id);
      const key=`${t._season?.id||"current"}-${rid}`;
      if(!map[key])map[key]={name,scores:[],trades:0};
      map[key].scores.push(c.sc);map[key].trades++;
    }
  }
  return Object.values(map).map(x=>({...x,score:x.scores.reduce((a,b)=>a+b,0)/x.scores.length})).sort((a,b)=>b.score-a.score);
}
function histUser(s,rid){
  let r=s.rosters.find(x=>Number(x.roster_id)===Number(rid)),u=s.users.find(x=>String(x.user_id)===String(r?.owner_id));
  return u?.display_name||u?.username||`Roster ${rid}`;
}
async function loadSeason(id){
  if(!id||S.seasons.some(x=>x.id===id))return null;
  let l;try{l=await get(`${API}/league/${id}`)}catch{return null}
  let users=[],rosters=[];
  try{users=await get(`${API}/league/${id}/users`)}catch{}
  try{rosters=await get(`${API}/league/${id}/rosters`)}catch{}
  let s={id,season:l.season||"Unknown",name:l.name||"League",previous:l.previous_league_id,users,rosters,trades:0};
  S.seasons.push(s);
  let seen=new Set;
  for(let w=1;w<=18;w++)try{
    for(let t of await get(`${API}/league/${id}/transactions/${w}`)||[])
      if(t.type==="trade"&&!seen.has(t.transaction_id)){seen.add(t.transaction_id);t._season=s;S.trades.push(t);s.trades++}
  }catch{}
  return s;
}
function renderTrade(t){
  let s=t._season,z=sides(t),e=Object.entries(z);
  if(e.length<2)return"";
  const cards=e.map(([rid,x])=>{
    let r=s.rosters.find(q=>Number(q.roster_id)===Number(rid))||roster(rid),c=score(r,x);
    return {rid,x,r,c,name:s?histUser(s,rid):user(r?.owner_id)};
  });
  const a=cards[0],b=cards[1];
  return `<div class=trade>
    <div><b>${t.created?new Date(t.created).toLocaleDateString():"Unknown date"}</b> <span class=pill>${esc(s.season)} season</span></div>
    <div class=trade-summary>
      ${cards.map((q,i)=>`<div class=summary-box>
        <div class=summary-title><b>${esc(q.name)}</b><span class=grade>${q.c.grade}</span></div>
        <div class=muted>${q.c.dir} • ${Math.round(q.c.sc)}/100</div>
        <div class=summary-stat"><span>Received</span><b>${fmt(q.x.valueReceived)}</b></div>
        <div class=summary-stat"><span>Sent</span><b>${fmt(q.x.valueSent)}</b></div>
        <div class=summary-stat"><span>Market edge</span><b class="${q.c.edge>=0?"delta-pos":"delta-neg"}">${q.c.edge>=0?"+":""}${q.c.edge.toFixed(1)}</b></div>
        <div class=label>Received</div>${assetHTML(q.x.received)}
        <div class=label>Sent</div>${assetHTML(q.x.sent)}
        <div class=bar><i style="width:${q.c.sc}%"></i></div>
        
      </div>${i===0?`<div class=trade-arrow>⇄</div>`:""}`).join("")}
    </div>
  </div>`;
}
function renderTrades(){
  if(!S.trades.length)return`<div class=panel>No trades found.</div>`;
  return `<div class=panel><h2>Trade Intelligence — V2.3</h2>
    <div class=notice><b>Individual grades are now paired with an explanation.</b> Scores combine market value, positional need, team direction, age profile and package structure. Historical trades are labeled by their original season; current Dynasty Dealer values are used rather than pretending we have historical frozen values.</div>
    ${S.trades.slice().sort((a,b)=>(b.created||0)-(a.created||0)).map(renderTrade).join("")}
  </div>`;
}
function renderPower(){
  const rows=tradePower().slice(0,12);
  return `<div class=panel><h2>League Trade Power Rankings</h2>
    <p class=muted>Average individual trade score for each manager represented in the synced trade history. Higher is better.</p>
    ${rows.length?`<table class=power-table><thead><tr><th>Rank</th><th>Manager</th><th>Trade Score</th><th>Grade</th><th>Trades</th></tr></thead><tbody>
      ${rows.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name)}</b></td><td>${Math.round(x.score)}</td><td><span class=grade>${grade(x.score)}</span></td><td>${x.trades}</td></tr>`).join("")}
    </tbody></table>`:"<p>No graded trades yet.</p>"}
  </div>`;
}
function render(){
  let html;
  if(S.tab==="trades")html=renderTrades()+renderPower();
  else if(S.tab==="history")html=`<div class=panel><h2>League History</h2>${S.seasons.map((s,i)=>`<p><b>${esc(s.season)}</b>${i===0?" — Current":""} • ${s.trades} trades • previous league: ${esc(s.previous||"None")}</p>`).join("")}</div>`;
  else if(S.tab==="grades")html=`<div class=panel><h2>V2.3 Grading Model</h2><p><b>Market edge:</b> compares received vs. sent dynasty market value.</p><p><b>Positional fit:</b> rewards assets that address weaker roster positions and lightly penalizes redundant concentration.</p><p><b>Team direction:</b> rebuilds receive a younger-asset adjustment; contenders receive a near-term age-window adjustment.</p><p><b>Package structure:</b> modest bonus for adding multiple assets without sacrificing equivalent value.</p><p><b>Trade Power Rankings:</b> averages a manager's individual trade scores across the synced history.</p><div class=notice>Grades remain contextual decision grades, not claims about who ultimately won a trade in hindsight.</div></div>`;
  else if(S.tab==="overview"){
    const rankings=tradePower().slice(0,3);
    html=`<div class=grid><div class=card><h3>Teams</h3><div class=metric>${S.rosters.length}</div></div><div class=card><h3>Trades</h3><div class=metric>${S.trades.length}</div></div><div class=card><h3>Seasons</h3><div class=metric>${S.seasons.length}</div></div><div class=card><h3>Market Assets</h3><div class=metric>${Object.keys(S.market).length}</div></div></div>
      <div class=panel><h2>Trade Leaders</h2><div class=rank-grid>${rankings.map((x,i)=>`<div class=rank-card><div class=rank-num>#${i+1}</div><b>${esc(x.name)}</b><div class=rank-score>${Math.round(x.score)} <span class=grade>${grade(x.score)}</span></div><div class=muted>${x.trades} graded trade${x.trades===1?"":"s"}</div></div>`).join("")||"<p>No trade data yet.</p>"}</div></div>`;
  }else html=`<div class=panel><h2>${S.tab[0].toUpperCase()+S.tab.slice(1)}</h2><p class=muted>Data synced from Sleeper.</p></div>`;
  $("#app").innerHTML=html;
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===S.tab));
}
async function sync(){
  let st=$("#status");st.textContent="Syncing current and historical league data…";
  try{
    S.league=await get(`${API}/league/${LEAGUE_ID}`);
    S.users=await get(`${API}/league/${LEAGUE_ID}/users`);
    S.rosters=await get(`${API}/league/${LEAGUE_ID}/rosters`);
    S.drafts=await get(`${API}/league/${LEAGUE_ID}/drafts`);
    S.players=await cache("dhq_players",`${API}/players/nfl`);
    try{
      let raw=await cache("dhq_market",MARKET_URL);
      for(let x of(Array.isArray(raw)?raw:(raw.players||[])))if(x.sleeper_id!=null)S.market[x.sleeper_id]=x;
    }catch{}
    S.trades=[];S.seasons=[];let id=LEAGUE_ID;
    for(let i=0;i<HISTORY_MAX&&id;i++){let s=await loadSeason(id);if(!s)break;id=s.previous}
    st.textContent=`Synced • ${S.trades.length} trades across ${S.seasons.length} seasons`;
    render();
  }catch(e){st.textContent=`Sync failed: ${e.message}`}
}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;render()});
$("#sync").onclick=sync;
render();sync();
