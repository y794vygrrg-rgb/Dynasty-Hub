const LEAGUE_ID="1327325072385409024",API="https://api.sleeper.app/v1",MARKET_URL="https://www.dynastydealer.com/api/player-values",CACHE=86400000,HISTORY_MAX=8;
const S={tab:"overview",users:[],rosters:[],drafts:[],picks:[],trades:[],players:{},market:{},seasons:[],league:null,tradedPicks:[],historicalDrafts:[],tradeTeam:"all",tradeYear:"all",draftTeam:"all",draftYear:"all",selectedTeam:null,projections:{},projectionMeta:{available:false,source:"Fallback model"}};
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
function avgAge(r){const a=(r?.players||[]).map(age).filter(Boolean);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function direction(r){
  let a=avgAge(r)??26,rv=rosterValue(r),rank=Number(r?.settings?.rank||99);
  if((rank<=4&&rv>25000)||(a<25.5&&rv>22000))return"contender";
  if(rank>=9||a>=27.2)return"rebuild";
  return"middle";
}
function pickValue(p){
  const base={1:5000,2:2800,3:1500,4:800}[Number(p.round)]||500;
  const y=Math.max(0,(Number(p.season)||new Date().getFullYear())-new Date().getFullYear());
  return Math.round(base*Math.pow(.82,y));
}
function pickName(p){
  const names={1:"1st",2:"2nd",3:"3rd",4:"4th"};
  return `${p.season} ${names[Number(p.round)]||`${p.round}th`}`;
}

/* ---------- V2.4 roster intelligence ---------- */
function starterSlots(){
  const raw=S.league?.roster_positions||[];
  return raw.filter(x=>!["BN","IR","TAXI"].includes(String(x).toUpperCase()));
}
function optimizedStarterIds(r){
  const remaining=(r?.players||[]).map(String);
  const chosen=[];
  const take=(eligible)=>{
    let best=null,bestVal=-1;
    for(const id of remaining){
      const p=pos(id);
      if(eligible(p,id)&&playerProductionScore(id)>bestVal){best=id;bestVal=playerProductionScore(id)}
    }
    if(best!=null){
      chosen.push(best);
      remaining.splice(remaining.indexOf(best),1);
    }
  };
  for(const slotRaw of starterSlots()){
    const slot=String(slotRaw).toUpperCase();
    if(["QB","RB","WR","TE","K","DEF"].includes(slot))take(p=>p===slot);
    else if(["FLEX","W/R/T","WRRB_FLEX"].includes(slot))take(p=>["RB","WR","TE"].includes(p));
    else if(["SUPER_FLEX","SUPERFLEX","Q/W/R/T"].includes(slot))take(p=>["QB","RB","WR","TE"].includes(p));
    else if(slot.includes("REC_FLEX"))take(p=>["WR","TE"].includes(p));
    else take(()=>true);
  }
  return chosen;
}
function starterValue(r){return optimizedStarterIds(r).reduce((n,id)=>n+value(id),0)}
function benchValue(r){return Math.max(0,rosterValue(r)-starterValue(r))}
function positionValue(r,p){return(r?.players||[]).filter(id=>pos(id)===p).reduce((n,id)=>n+value(id),0)}
function percentile(val,arr){
  if(!arr.length)return 50;
  const sorted=[...arr].sort((a,b)=>a-b);
  const below=sorted.filter(x=>x<val).length;
  const equal=sorted.filter(x=>x===val).length;
  return Math.round(((below+equal*.5)/sorted.length)*100);
}
function pickInventory(rid){
  const year0=Number(S.league?.season)||new Date().getFullYear();
  const years=[year0,year0+1,year0+2];
  const rounds=[1,2,3,4];
  const picks=[];
  for(const season of years){
    for(const round of rounds){
      let owner=Number(rid);
      const moved=S.tradedPicks.find(p=>Number(p.season)===season&&Number(p.round)===round&&Number(p.roster_id)===Number(rid));
      if(moved)owner=Number(moved.owner_id);
      if(owner===Number(rid))picks.push({season,round,roster_id:Number(rid),owner_id:Number(rid)});
    }
  }
  // Picks acquired from another original roster
  for(const p of S.tradedPicks){
    if(Number(p.owner_id)===Number(rid)&&Number(p.roster_id)!==Number(rid)){
      if(!picks.some(x=>Number(x.season)===Number(p.season)&&Number(x.round)===Number(p.round)&&Number(x.roster_id)===Number(p.roster_id))){
        picks.push({...p});
      }
    }
  }
  return picks;
}
function draftCapitalValue(rid){return pickInventory(rid).reduce((n,p)=>n+pickValue(p),0)}
function teamMetrics(r){
  const all=S.rosters;
  const total=rosterValue(r),starters=starterValue(r),bench=benchValue(r),a=avgAge(r)??26,capital=draftCapitalValue(r.roster_id);
  const totalPct=percentile(total,all.map(rosterValue));
  const starterPct=percentile(starters,all.map(starterValue));
  const capitalPct=percentile(capital,all.map(x=>draftCapitalValue(x.roster_id)));
  const youthPct=percentile(-a,all.map(x=>-(avgAge(x)??26)));
  const score=Math.round(clamp(totalPct*.35+starterPct*.30+capitalPct*.20+youthPct*.15,0,100));
  let window="Competitive";
  if(totalPct>=70&&starterPct>=70)window=a<=26.8?"Win Now":"Contender";
  else if(capitalPct>=70&&a<=25.8)window="Ascending";
  else if(totalPct<=35&&capitalPct>=55)window="Rebuilding";
  else if(totalPct<=30)window="Reset Needed";
  const posVals={QB:positionValue(r,"QB"),RB:positionValue(r,"RB"),WR:positionValue(r,"WR"),TE:positionValue(r,"TE")};
  const posPct={};
  for(const p of Object.keys(posVals))posPct[p]=percentile(posVals[p],all.map(x=>positionValue(x,p)));
  const sortedPos=Object.entries(posPct).sort((a,b)=>b[1]-a[1]);
  const strength=sortedPos[0],weakness=sortedPos[sortedPos.length-1];
  return{total,starters,bench,age:a,capital,totalPct,starterPct,capitalPct,youthPct,score,window,posVals,posPct,strength,weakness};
}
function recommendation(m){
  const notes=[];
  if(m.window==="Win Now"||m.window==="Contender"){
    if(m.capitalPct>=60)notes.push("You have enough draft capital to buy a veteran upgrade without emptying the cupboard");
    else notes.push("Protect premium future picks unless the return clearly moves the starting lineup");
    if(m.weakness[1]<35)notes.push(`Target ${m.weakness[0]} depth as the clearest roster weakness`);
  }else if(m.window==="Ascending"){
    notes.push("Stay patient with the young core and avoid paying peak prices for aging production");
    if(m.capitalPct>=70)notes.push("Your draft-capital advantage gives you flexibility to consolidate later");
  }else{
    notes.push("Prioritize young appreciating assets and future first-round picks over short-term production");
    if(m.strength[1]>=70)notes.push(`Consider using surplus ${m.strength[0]} value to address weaker areas or add picks`);
  }
  return notes.join(". ")+".";
}
function teamPower(){
  return S.rosters.map(r=>({r,m:teamMetrics(r),name:user(r.owner_id)})).sort((a,b)=>b.m.score-a.m.score);
}


/* ---------- V2.5 draft intelligence ---------- */
function draftPickExpectedValue(p){
  const pickNo=Number(p.pick_no||0);
  if(!pickNo)return 0;
  // Smooth 12-team rookie-pick curve: early firsts premium, declining through round 4.
  const round=Math.ceil(pickNo/12);
  const slot=((pickNo-1)%12)+1;
  const roundBase={1:7600,2:3600,3:1900,4:1000}[round]||600;
  const decay={1:0.055,2:0.045,3:0.035,4:0.03}[round]||0.03;
  return Math.round(roundBase*Math.exp(-decay*(slot-1)));
}
function draftPickContextScore(p){
  const actual=value(p.player_id);
  const expected=draftPickExpectedValue(p);
  const delta=expected?((actual-expected)/expected)*100:0;
  return {actual,expected,delta};
}
function draftGradeForPick(p){
  const c=draftPickContextScore(p);
  const rid=Number(p.roster_id);
  const r=roster(rid);
  const draftedPos=pos(p.player_id);
  const posPct=teamMetrics(r).posPct[draftedPos]??50;
  let fit=0;
  if(posPct<=30)fit=6;
  else if(posPct<=45)fit=3;
  else if(posPct>=75)fit=-3;
  const currentBonus=clamp(c.delta/8,-12,12);
  const score=clamp(75+fit+currentBonus,0,100);
  return {score,grade:grade(score),fit,...c};
}
function draftReason(p,g){
  const parts=[];
  if(g.delta>=35)parts.push("player currently sits well above the expected value for this draft slot");
  else if(g.delta>=10)parts.push("player currently exceeds expected slot value");
  else if(g.delta<=-35)parts.push("player currently trails the expected value for this draft slot");
  else if(g.delta<=-10)parts.push("player currently sits below expected slot value");
  else parts.push("current value is close to the expected value for this slot");
  if(g.fit>=5)parts.push("the pick also addressed a clear roster need");
  else if(g.fit>=2)parts.push("the pick improved positional balance");
  else if(g.fit<0)parts.push("the selection added to an already strong position");
  return parts.join(" • ")+".";
}
function draftManagerSummary(source=S.historicalDrafts){
  const map={};
  for(const d of source){
    for(const p of d.picks){
      const g=draftGradeForPick(p);
      const name=d.managerName(p.roster_id);
      const key=`${d.draft_id}-${p.roster_id}`;
      if(!map[key])map[key]={name,season:d.season,scores:[],count:0};
      map[key].scores.push(g.score);map[key].count++;
    }
  }
  return Object.values(map).map(x=>({...x,score:x.scores.reduce((a,b)=>a+b,0)/x.scores.length})).sort((a,b)=>b.score-a.score);
}
async function loadHistoricalDrafts(){
  S.historicalDrafts=[];
  for(const season of S.seasons){
    let drafts=[];
    try{drafts=await get(`${API}/league/${season.id}/drafts`)}catch{}
    for(const d of drafts||[]){
      let picks=[];
      try{picks=await get(`${API}/draft/${d.draft_id}/picks`)}catch{}
      const managerName=(rid)=>{
        const rr=season.rosters.find(r=>Number(r.roster_id)===Number(rid));
        const uu=season.users.find(u=>String(u.user_id)===String(rr?.owner_id));
        return uu?.display_name||uu?.username||`Roster ${rid}`;
      };
      S.historicalDrafts.push({
        draft_id:d.draft_id,
        season:d.season||season.season,
        status:d.status,
        type:d.type,
        picks,
        managerName
      });
    }
  }
}



/* V2.8 */
async function loadProjectionData(){S.projections={};S.projectionMeta={available:false,source:"Fallback model"};try{const raw=await get("data/projections.json?v=2.8"),rows=Array.isArray(raw)?raw:(raw.players||[]);for(const x of rows){const sid=String(x.sleeper_id??x.player_id??"");if(sid)S.projections[sid]=x}if(Object.keys(S.projections).length)S.projectionMeta={available:true,source:raw.source||"Projection feed",updated_at:raw.updated_at||null}}catch{}}
function projection(id){return S.projections[String(id)]||null}
function projectedPoints(id){const p=projection(id);if(!p)return null;const v=Number(p.points_half??p.half_ppr_points??p.projected_points??p.points);return Number.isFinite(v)?v:null}
function roleScore(id){const p=player(id),pr=projection(id);if(pr&&Number.isFinite(Number(pr.role_score)))return clamp(Number(pr.role_score),0,100);let s=50;if(p.active===false)s-=45;if(!p.team)s-=25;const inj=String(p.injury_status||"").toUpperCase();if(["IR","PUP","OUT"].includes(inj))s-=22;else if(["DOUBTFUL","D"].includes(inj))s-=12;else if(["QUESTIONABLE","Q"].includes(inj))s-=5;const d=Number(p.depth_chart_order);if(d===1)s+=25;else if(d===2)s+=10;else if(d>=3)s-=8;return clamp(s,0,100)}
function fallbackProductionScore(id){const mv=value(id),role=roleScore(id),all=(S.rosters||[]).flatMap(r=>r.players||[]).map(value).filter(v=>v>0),mvPct=percentile(mv,all);return clamp(mvPct*.65+role*.35,0,100)}
function playerProductionScore(id){const pp=projectedPoints(id);if(pp!=null){const same=(S.rosters||[]).flatMap(r=>r.players||[]).filter(x=>pos(x)===pos(id)).map(projectedPoints).filter(x=>x!=null),projPct=percentile(pp,same);return clamp(projPct*.85+roleScore(id)*.15,0,100)}return fallbackProductionScore(id)}
function playerTier(id){const s=playerProductionScore(id);if(s>=88)return["Elite","tier-elite"];if(s>=72)return["Strong Starter","tier-starter"];if(s>=55)return["Flex / Usable","tier-flex"];if(s>=35)return["Depth","tier-depth"];return["Fringe","tier-fringe"]}
function replacementLevel(p){const ids=(S.rosters||[]).flatMap(r=>r.players||[]).filter(id=>pos(id)===p),vals=ids.map(id=>playerProductionScore(id)).sort((a,b)=>b-a),mult={QB:1.1,RB:2.5,WR:3,TE:1.2}[p]||1.5,idx=Math.min(vals.length-1,Math.max(0,Math.round(S.rosters.length*mult)-1));return vals[idx]??40}
function vorpScore(id){return Math.max(0,playerProductionScore(id)-replacementLevel(pos(id)))}
function usableDepthIds(r){const st=new Set(optimizedStarterIds(r).map(String));return(r?.players||[]).map(String).filter(id=>!st.has(id)&&playerProductionScore(id)>=50)}
function projectedStarterStrength(r){const ids=optimizedStarterIds(r);return ids.length?ids.reduce((n,id)=>n+playerProductionScore(id),0)/ids.length:0}
function starterVorp(r){return optimizedStarterIds(r).reduce((n,id)=>n+vorpScore(id),0)}
function depthQuality(r){const d=usableDepthIds(r),t=Math.max(4,Math.round(starterSlots().length*.45));return clamp(d.length/t*100,0,100)}
function nflRoleSecurity(r){const ids=optimizedStarterIds(r);return ids.length?ids.reduce((n,id)=>n+roleScore(id),0)/ids.length:0}
function intelligenceSummary(r){return optimizedStarterIds(r).sort((a,b)=>playerProductionScore(b)-playerProductionScore(a)).slice(0,8).map(id=>({id,name:player(id).full_name||market(id).name||id,pos:pos(id),projected:projectedPoints(id),production:playerProductionScore(id),role:roleScore(id),vorp:vorpScore(id),tier:playerTier(id)}))}

/* V2.7 */
function positionLeagueRank(r,p){const a=S.rosters.map(x=>({id:x.roster_id,v:positionValue(x,p)})).sort((a,b)=>b.v-a.v);return a.findIndex(x=>Number(x.id)===Number(r.roster_id))+1}
function positionLabel(rank,n){if(rank<=2)return["Elite","One of the league's strongest groups"];if(rank<=4)return["Strong","Above average"];if(rank<=8)return["Average","Middle of the league"];if(rank<=10)return["Weak","Below average"];return["Major Need","One of the league's weakest groups"]}
function winNowMetrics(r){const a=S.rosters,sp=projectedStarterStrength(r),v=starterVorp(r),d=depthQuality(r),role=nflRoleSecurity(r),mp=percentile(rosterValue(r),a.map(rosterValue)),spp=percentile(sp,a.map(projectedStarterStrength)),vp=percentile(v,a.map(starterVorp)),dp=percentile(d,a.map(depthQuality)),rp=percentile(role,a.map(nflRoleSecurity)),score=Math.round(clamp(spp*.55+vp*.15+dp*.15+rp*.10+mp*.05,0,100)),pr={};for(const p of["QB","RB","WR","TE"]){const rows=a.map(x=>({rid:x.roster_id,score:(x.players||[]).filter(id=>pos(id)===p).sort((aa,bb)=>playerProductionScore(bb)-playerProductionScore(aa)).slice(0,p==="QB"||p==="TE"?2:4).reduce((n,id)=>n+playerProductionScore(id),0)})).sort((aa,bb)=>bb.score-aa.score);pr[p]=rows.findIndex(x=>Number(x.rid)===Number(r.roster_id))+1}const label=score>=90?"Championship Favorite":score>=82?"Strong Contender":score>=72?"Playoff Caliber":score>=60?"Fringe Playoff":"Rebuilding / Long Shot";return{score,label,starters:starterValue(r),bench:benchValue(r),total:rosterValue(r),capital:draftCapitalValue(r.roster_id),posRanks:pr,starterProd:sp,vorp:v,depth:d,role,marketPct:mp}}
function winNowPower(){return S.rosters.map(r=>({r,name:user(r.owner_id),m:winNowMetrics(r)})).sort((a,b)=>b.m.score-a.m.score)}
function managerOptions(){const n=new Set();S.users.forEach(u=>n.add(u.display_name||u.username));S.seasons.forEach(s=>(s.users||[]).forEach(u=>n.add(u.display_name||u.username)));return[...n].filter(Boolean).sort()}
function tradeNames(t){return Object.keys(sides(t)).map(r=>t._season?histUser(t._season,r):user(roster(r)?.owner_id))}
function filteredTrades(){return S.trades.filter(t=>(S.tradeTeam==="all"||tradeNames(t).includes(S.tradeTeam))&&(S.tradeYear==="all"||String(t._season?.season)===S.tradeYear))}
function filteredDrafts(){return S.historicalDrafts.map(d=>({...d,picks:d.picks.filter(p=>(S.draftTeam==="all"||d.managerName(p.roster_id)===S.draftTeam)&&(S.draftYear==="all"||String(d.season)===S.draftYear))})).filter(d=>d.picks.length)}
function filterBar(k){const team=S[k+"Team"],year=S[k+"Year"],years=[...new Set((k==="trade"?S.seasons:S.historicalDrafts).map(x=>String(x.season)))].sort().reverse();return`<div class=filter-bar><select id=${k}Team><option value=all>All Teams</option>${managerOptions().map(n=>`<option ${team===n?"selected":""}>${esc(n)}</option>`).join("")}</select><select id=${k}Year><option value=all>All Seasons</option>${years.map(y=>`<option ${year===y?"selected":""}>${y}</option>`).join("")}</select><button id=${k}Reset>Reset Filters</button></div>`}
function bindFilters(k){const t=$(`#${k}Team`),y=$(`#${k}Year`),r=$(`#${k}Reset`);if(t)t.onchange=()=>{S[k+"Team"]=t.value;render()};if(y)y.onchange=()=>{S[k+"Year"]=y.value;render()};if(r)r.onclick=()=>{S[k+"Team"]="all";S[k+"Year"]="all";render()}}

/* ---------- Trade engine from V2.3.1 ---------- */
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
  for(let x of Object.values(s)){x.valueReceived=x.received.reduce((n,a)=>n+a.value,0);x.valueSent=x.sent.reduce((n,a)=>n+a.value,0)}
  return s;
}
function score(r,s){
  const rec=s.valueReceived||0,sent=s.valueSent||0,den=Math.max(rec,sent,1);
  const marketPct=(rec-sent)/den,edge=clamp(marketPct*28,-18,18),dir=direction(r);
  const pv={QB:0,RB:0,WR:0,TE:0};for(let id of r?.players||[]){let p=pos(id);if(pv[p]!=null)pv[p]+=value(id)}
  const rp={QB:0,RB:0,WR:0,TE:0};s.received.forEach(a=>{if(rp[a.pos]!=null)rp[a.pos]+=a.value});
  let need=0,total=Object.values(pv).reduce((a,b)=>a+b,0)||1;
  for(let p of Object.keys(pv)){let sh=pv[p]/total;if(sh<.16&&rp[p]>0)need+=5;else if(sh>.38&&rp[p]>pv[p]*.2)need-=3}
  const recp=s.received.filter(a=>a.type==="player"&&a.age);let adj=0;
  if(dir==="rebuild"){let y=recp.filter(a=>a.age<=24).reduce((n,a)=>n+a.value,0),o=recp.filter(a=>a.age>=28).reduce((n,a)=>n+a.value,0);adj=clamp((y-o)/Math.max(rec,1)*14,-6,8)}
  else if(dir==="contender"){let w=recp.filter(a=>a.age>=25&&a.age<=29).reduce((n,a)=>n+a.value,0),f=recp.filter(a=>a.age<=23).reduce((n,a)=>n+a.value,0);adj=clamp((w-f)/Math.max(rec,1)*12,-6,8)}
  const volume=rec>sent?2:rec<sent?-1:0,packageAdj=s.received.length>=2&&s.sent.length<=1?1:0;
  const sc=clamp(70+edge+need+adj+volume+packageAdj,0,100);
  return{sc,grade:grade(sc),edge,need,adj,dir,volume,packageAdj,marketPct};
}
function reason(c){
  const parts=[];
  if(c.edge>=8)parts.push(`Strong market-value win (+${c.edge.toFixed(1)} grade points)`);
  else if(c.edge>=3)parts.push(`Positive market-value edge (+${c.edge.toFixed(1)} grade points)`);
  else if(c.edge<=-8)parts.push(`Significant market-value premium paid (${c.edge.toFixed(1)} grade points)`);
  else if(c.edge<=-3)parts.push(`Small market-value premium paid (${c.edge.toFixed(1)} grade points)`);
  else parts.push(`Near market-value neutral (${c.edge>=0?"+":""}${c.edge.toFixed(1)} grade points)`);
  if(c.need>=5)parts.push("fills a clear positional weakness");else if(c.need>=2)parts.push("improves positional balance");else if(c.need<=-2)parts.push("adds to a position that was already relatively strong");
  if(c.adj>=4)parts.push(c.dir==="rebuild"?"meaningfully improves the team's age curve for a rebuild":"adds assets that fit the contender window");
  else if(c.adj>=2)parts.push(c.dir==="rebuild"?"slightly improves the team's age curve":"fits the team's competitive window");
  else if(c.adj<=-4)parts.push(c.dir==="rebuild"?"works against the rebuilding timeline":"creates a notable age-profile concern");
  else if(c.adj<=-2)parts.push("has a modest age-profile drawback");
  if(c.volume>0)parts.push("also receives slightly more total asset value");
  if(c.packageAdj>0)parts.push("gets a small package-structure bonus");
  return parts.join(" • ")+".";
}
function assetHTML(a){return a.length?a.map(x=>`<div class="asset"><span>${esc(x.name)} ${x.pos&&x.pos!=="PICK"?`<small>${x.pos}</small>`:""}</span><b>${fmt(x.value)}</b></div>`).join(""):"<span class=muted>None</span>"}
function histUser(s,rid){let r=s.rosters.find(x=>Number(x.roster_id)===Number(rid)),u=s.users.find(x=>String(x.user_id)===String(r?.owner_id));return u?.display_name||u?.username||`Roster ${rid}`}
async function loadSeason(id){
  if(!id||S.seasons.some(x=>x.id===id))return null;
  let l;try{l=await get(`${API}/league/${id}`)}catch{return null}
  let users=[],rosters=[];try{users=await get(`${API}/league/${id}/users`)}catch{}try{rosters=await get(`${API}/league/${id}/rosters`)}catch{}
  let s={id,season:l.season||"Unknown",name:l.name||"League",previous:l.previous_league_id,users,rosters,trades:0};S.seasons.push(s);
  let seen=new Set;for(let w=1;w<=18;w++)try{for(let t of await get(`${API}/league/${id}/transactions/${w}`)||[])if(t.type==="trade"&&!seen.has(t.transaction_id)){seen.add(t.transaction_id);t._season=s;S.trades.push(t);s.trades++}}catch{}
  return s;
}
function tradePower(source=S.trades){
  const map={};
  for(const t of source){
    const z=sides(t);
    for(const[rid,x]of Object.entries(z)){
      const r=t._season?.rosters.find(q=>Number(q.roster_id)===Number(rid))||roster(rid),c=score(r,x),name=t._season?histUser(t._season,rid):user(r?.owner_id),key=`${t._season?.id||"current"}-${rid}`;
      if(!map[key])map[key]={name,scores:[],trades:0};map[key].scores.push(c.sc);map[key].trades++;
    }
  }
  return Object.values(map).map(x=>({...x,score:x.scores.reduce((a,b)=>a+b,0)/x.scores.length})).sort((a,b)=>b.score-a.score);
}
function renderTrade(t){
  let s=t._season,z=sides(t),e=Object.entries(z);if(e.length<2)return"";
  const cards=e.map(([rid,x])=>{let r=s.rosters.find(q=>Number(q.roster_id)===Number(rid))||roster(rid),c=score(r,x);return{rid,x,r,c,name:s?histUser(s,rid):user(r?.owner_id)}});
  return `<div class=trade><div><b>${t.created?new Date(t.created).toLocaleDateString():"Unknown date"}</b> <span class=pill>${esc(s.season)} season</span></div><div class=trade-summary>
  ${cards.map((q,i)=>`<div class=summary-box><div class=summary-title><b>${esc(q.name)}</b><span class=grade>${q.c.grade}</span></div><div class=muted>${q.c.dir} • ${Math.round(q.c.sc)}/100</div><div class=summary-stat><span>Received</span><b>${fmt(q.x.valueReceived)}</b></div><div class=summary-stat><span>Sent</span><b>${fmt(q.x.valueSent)}</b></div><div class=summary-stat><span>Market edge</span><b class="${q.c.edge>=0?"delta-pos":"delta-neg"}">${q.c.edge>=0?"+":""}${q.c.edge.toFixed(1)}</b></div><div class="explain">${esc(reason(q.c))}</div><div class=label>Received</div>${assetHTML(q.x.received)}<div class=label>Sent</div>${assetHTML(q.x.sent)}<div class=bar><i style="width:${q.c.sc}%"></i></div></div>${i===0?`<div class=trade-arrow>⇄</div>`:""}`).join("")}</div></div>`;
}
function renderTrades(){const rows=filteredTrades();return `<div class=panel><h2>Trade Intelligence</h2>${filterBar("trade")}<div class=filter-count>${rows.length} trades shown</div>${rows.length?rows.slice().sort((a,b)=>(b.created||0)-(a.created||0)).map(renderTrade).join(""):"<p>No trades match.</p>"}</div>`}
function renderTradePower(){
  const rows=tradePower(filteredTrades()).slice(0,12);
  return `<div class=panel><h2>Trade Power Rankings</h2><table class=power-table><thead><tr><th>Rank</th><th>Manager</th><th>Score</th><th>Grade</th><th>Trades</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name)}</b></td><td>${Math.round(x.score)}</td><td>${grade(x.score)}</td><td>${x.trades}</td></tr>`).join("")}</tbody></table></div>`;
}


/* ---------- V2.6 League Legacy ---------- */
function normalizeManagerName(name){return String(name||"Unknown").trim()}
function currentManagerByName(name){
  const n=normalizeManagerName(name).toLowerCase();
  return S.rosters.find(r=>normalizeManagerName(user(r.owner_id)).toLowerCase()===n);
}
function managerHistory(){
  const map={};
  for(const s of S.seasons){
    for(const r of s.rosters||[]){
      const name=histUser(s,r.roster_id),key=normalizeManagerName(name).toLowerCase();
      if(!map[key])map[key]={name,seasons:0,wins:0,losses:0,ties:0,points:0,playoffs:0};
      const x=map[key],set=r.settings||{};
      x.seasons++;
      x.wins+=Number(set.wins||0);x.losses+=Number(set.losses||0);x.ties+=Number(set.ties||0);
      x.points+=Number(set.fpts||0)+(Number(set.fpts_decimal||0)/100);
      if(Number(set.rank||99)<=6)x.playoffs++;
    }
  }
  return map;
}
function currentTradeScores(){
  const by={};
  for(const t of S.trades){
    const z=sides(t);
    for(const [rid,x] of Object.entries(z)){
      const r=t._season?.rosters.find(q=>Number(q.roster_id)===Number(rid))||roster(rid);
      const name=t._season?histUser(t._season,rid):user(r?.owner_id);
      const k=normalizeManagerName(name).toLowerCase(),c=score(r,x);
      if(!by[k])by[k]={scores:[],count:0,best:null,worst:null};
      by[k].scores.push(c.sc);by[k].count++;
      const rec={score:c.sc,grade:c.grade,date:t.created?new Date(t.created).toLocaleDateString():"Unknown"};
      if(!by[k].best||rec.score>by[k].best.score)by[k].best=rec;
      if(!by[k].worst||rec.score<by[k].worst.score)by[k].worst=rec;
    }
  }
  for(const k of Object.keys(by))by[k].avg=by[k].scores.reduce((a,b)=>a+b,0)/by[k].scores.length;
  return by;
}
function currentDraftScores(){
  const by={};
  for(const d of S.historicalDrafts||[]){
    for(const p of d.picks||[]){
      const name=d.managerName(p.roster_id),k=normalizeManagerName(name).toLowerCase(),g=draftGradeForPick(p);
      if(!by[k])by[k]={scores:[],count:0,best:null,worst:null};
      by[k].scores.push(g.score);by[k].count++;
      const rec={score:g.score,grade:g.grade,player:player(p.player_id).full_name||p.player_id,pick:p.pick_no,season:d.season};
      if(!by[k].best||rec.score>by[k].best.score)by[k].best=rec;
      if(!by[k].worst||rec.score<by[k].worst.score)by[k].worst=rec;
    }
  }
  for(const k of Object.keys(by))by[k].avg=by[k].scores.reduce((a,b)=>a+b,0)/by[k].scores.length;
  return by;
}
function legacyRankings(){
  const hist=managerHistory(),tr=currentTradeScores(),dr=currentDraftScores(),team=teamPower();
  const teamBy={};for(const x of team)teamBy[normalizeManagerName(x.name).toLowerCase()]=x.m.score;
  const keys=new Set([...Object.keys(hist),...Object.keys(tr),...Object.keys(dr),...Object.keys(teamBy)]);
  const rows=[];
  for(const k of keys){
    const h=hist[k]||{name:k,seasons:0,wins:0,losses:0,ties:0,points:0,playoffs:0};
    const games=h.wins+h.losses+h.ties,winPct=games?(h.wins+.5*h.ties)/games:0.5;
    const recordScore=clamp(45+winPct*45+(h.seasons?Math.min(10,(h.playoffs/h.seasons)*10):0),0,100);
    const rosterScore=teamBy[k]??50,tradeScore=tr[k]?.avg??50,draftScore=dr[k]?.avg??50;
    const overall=Math.round(recordScore*.60+draftScore*.25+tradeScore*.15);
    rows.push({key:k,name:h.name||k,overall,rosterScore,tradeScore,draftScore,recordScore,history:h,trades:tr[k],drafts:dr[k]});
  }
  return rows.sort((a,b)=>b.overall-a.overall);
}
function leagueAwards(rows){
  if(!rows.length)return[];
  const maxBy=f=>[...rows].sort((a,b)=>f(b)-f(a))[0];
  const trade=maxBy(x=>x.tradeScore),draft=maxBy(x=>x.draftScore),roster=maxBy(x=>x.rosterScore),record=maxBy(x=>x.recordScore);
  const rebuild=[...rows].filter(x=>{const r=currentManagerByName(x.name);return r&&direction(r)==="rebuild"}).sort((a,b)=>b.rosterScore-a.rosterScore)[0];
  return [
    ["Overall Dynasty GM",rows[0]?.name,`${rows[0]?.overall}/100`],
    ["Trade King",trade?.name,`${Math.round(trade?.tradeScore||0)}/100`],
    ["Draft Guru",draft?.name,`${Math.round(draft?.draftScore||0)}/100`],
    ["Best Current Roster",roster?.name,`${Math.round(roster?.rosterScore||0)}/100`],
    ["Best Historical Record",record?.name,`${Math.round(record?.recordScore||0)}/100`],
    ...(rebuild?[["Best Rebuilder",rebuild.name,`${Math.round(rebuild.rosterScore)}/100 roster score`]]:[])
  ];
}
function renderLegacy(){
  const rows=legacyRankings(),awards=leagueAwards(rows);
  return `<div class=panel><h2>League Legacy — V2.6</h2>
    <div class=notice><b>Current Power and Legacy are separate.</b> All-Time GM Score: 60% historical performance, 25% draft success and 15% trade success. Current roster does not affect legacy rank. Missing categories use a neutral baseline rather than inventing data.</div>
    <h2>League Awards</h2><div class=awards>${awards.map(a=>`<div class=award><div class=award-label>${esc(a[0])}</div><div class=award-name>${esc(a[1]||"—")}</div><div class=muted>${esc(a[2]||"")}</div></div>`).join("")}</div>
    <h2 style="margin-top:22px">All-Time Manager Rankings</h2>
    <div class=legacy-grid>${rows.map((x,i)=>`<div class=legacy-card>
      <div class=legacy-rank>#${i+1} Overall GM</div><h3>${esc(x.name)}</h3><div class=legacy-score>${x.overall}<small>/100</small></div>
      <div class=legacy-components>
        <div class=legacy-component><small>Roster</small><b>${Math.round(x.rosterScore)}</b></div>
        <div class=legacy-component><small>Trades</small><b>${Math.round(x.tradeScore)}</b></div>
        <div class=legacy-component><small>Draft</small><b>${Math.round(x.draftScore)}</b></div>
        <div class=legacy-component><small>Record</small><b>${Math.round(x.recordScore)}</b></div>
      </div>
      <div class=manager-detail>
        <b>Historical record:</b> ${x.history.wins}-${x.history.losses}${x.history.ties?`-${x.history.ties}`:""} across ${x.history.seasons} season${x.history.seasons===1?"":"s"}<br>
        <b>Playoff-rate proxy:</b> ${x.history.seasons?Math.round((x.history.playoffs/x.history.seasons)*100):0}%<br>
        <b>Trades graded:</b> ${x.trades?.count||0} • <b>Draft picks graded:</b> ${x.drafts?.count||0}
      </div>
    </div>`).join("")}</div>
    <h2 style="margin-top:22px">Manager Record Table</h2>
    <div style="overflow:auto"><table class=record-table><thead><tr><th>Rank</th><th>Manager</th><th>Overall</th><th>Record</th><th>Roster</th><th>Trades</th><th>Draft</th></tr></thead><tbody>
      ${rows.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name)}</b></td><td>${x.overall}</td><td>${x.history.wins}-${x.history.losses}</td><td>${Math.round(x.rosterScore)}</td><td>${Math.round(x.tradeScore)}</td><td>${Math.round(x.draftScore)}</td></tr>`).join("")}
    </tbody></table></div>
  </div>`;
}

/* ---------- V2.4 UI ---------- */
function renderRosters(){const teams=winNowPower();if(!teams.length)return`<div class=panel>No rosters.</div>`;if(!S.selectedTeam||!teams.some(x=>Number(x.r.roster_id)===Number(S.selectedTeam)))S.selectedTeam=teams[0].r.roster_id;const x=teams.find(q=>Number(q.r.roster_id)===Number(S.selectedTeam)),m=x.m,d=teamMetrics(x.r),rank=teams.indexOf(x)+1,intel=intelligenceSummary(x.r);return`<div class=panel><h2>2026 Power Rankings</h2><div class=notice><b>Production-first rankings:</b> 55% projected starter strength, 15% value over replacement, 15% usable depth, 10% NFL role security, 5% dynasty market signal.</div><div class=data-health><div class=data-health-card><small>Projection Layer</small><b>${S.projectionMeta.available?"Loaded":"Fallback model"}</b></div><div class=data-health-card><small>Market Layer</small><b>${Object.keys(S.market).length?"Loaded":"Unavailable"}</b></div><div class=data-health-card><small>NFL Role Layer</small><b>Sleeper metadata</b></div></div><div class=team-selector>${teams.map((q,i)=>`<button class="team-select-btn ${q===x?"active":""}" data-rid=${q.r.roster_id}><b>#${i+1} ${esc(q.name)}</b><small>${esc(q.m.label)} • ${q.m.score}/100</small></button>`).join("")}</div><div class=team-detail><div class=power-rank>#${rank} of ${teams.length}</div><h2>${esc(x.name)}</h2><div class=win-score>${m.score}<small>/100</small></div><div class=window>${esc(m.label)}</div><div class=analytics-grid><div class=analytics-stat><span>Starter Production</span><b>${Math.round(m.starterProd)}</b></div><div class=analytics-stat><span>Starter VORP</span><b>${Math.round(m.vorp)}</b></div><div class=analytics-stat><span>Usable Depth</span><b>${Math.round(m.depth)}/100</b></div><div class=analytics-stat><span>Role Security</span><b>${Math.round(m.role)}/100</b></div></div><h3>Position Groups</h3>${["QB","RB","WR","TE"].map(p=>{const r=m.posRanks[p],l=positionLabel(r,teams.length);return`<div class=position-rank><div><div class=position-label>${p}: ${l[0]}</div><div class=position-desc>${l[1]}</div></div><b>#${r} of ${teams.length}</b></div>`}).join("")}<h3>Most Relevant 2026 Starters</h3><div style="overflow:auto"><table class=player-intel-table><thead><tr><th>Player</th><th>Pos</th><th>Fantasy Tier</th><th>Projected Pts</th><th>Production</th><th>Role</th><th>Above Replacement</th></tr></thead><tbody>${intel.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${p.pos}</td><td><span class="role-chip ${p.tier[1]}">${p.tier[0]}</span></td><td>${p.projected==null?"—":Math.round(p.projected)}</td><td>${Math.round(p.production)}/100</td><td>${Math.round(p.role)}/100</td><td>${Math.round(p.vorp)}</td></tr>`).join("")}</tbody></table></div><div class=source-note>${S.projectionMeta.available?`Projection source: ${esc(S.projectionMeta.source)}`:"No licensed projection file is loaded yet. Production uses a clearly labeled fallback of dynasty market percentile + Sleeper role/security data."}</div><div class=outlook-box><b>Dynasty Outlook: ${esc(d.window)} — ${d.score}/100</b><div class=muted>Long-term dynasty value remains separate.</div></div></div></div>`}
function renderOverview(){
  const teams=teamPower(),traders=tradePower().slice(0,3);
  return `<div class=grid><div class=card><h3>Teams</h3><div class=metric>${S.rosters.length}</div></div><div class=card><h3>Trades</h3><div class=metric>${S.trades.length}</div></div><div class=card><h3>Seasons</h3><div class=metric>${S.seasons.length}</div></div><div class=card><h3>Market Assets</h3><div class=metric>${Object.keys(S.market).length}</div></div></div>
  <div class=panel><h2>Dynasty Power Leaders</h2><div class=rank-grid>${teams.slice(0,3).map((x,i)=>`<div class=rank-card><div class=rank-num>#${i+1}</div><b>${esc(x.name)}</b><div class=rank-score>${x.m.score}</div><div class=muted>${esc(x.m.window)} • ${fmt(x.m.total)} total value</div></div>`).join("")}</div></div>
  <div class=panel><h2>Trade Leaders</h2><div class=rank-grid>${traders.map((x,i)=>`<div class=rank-card><div class=rank-num>#${i+1}</div><b>${esc(x.name)}</b><div class=rank-score>${Math.round(x.score)} <span class=grade>${grade(x.score)}</span></div><div class=muted>${x.trades} graded trade${x.trades===1?"":"s"}</div></div>`).join("")||"<p>No trade data yet.</p>"}</div></div>`;
}
function renderDraft(){const _fd=filteredDrafts();
  if(!S.historicalDrafts.length)return `<div class=panel><h2>Draft Intelligence</h2>${filterBar("draft")}<p class=muted>No Sleeper draft history found yet. Tap Sync Sleeper.</p></div>`;
  const summaries=draftManagerSummary(_fd);
  const allPicks=_fd.flatMap(d=>d.picks.map(p=>({...p,_season:d.season,_manager:d.managerName(p.roster_id)})));
  const best=[...allPicks].sort((a,b)=>draftGradeForPick(b).score-draftGradeForPick(a).score)[0];
  const worst=[...allPicks].sort((a,b)=>draftGradeForPick(a).score-draftGradeForPick(b).score)[0];
  return `<div class=panel><h2>Draft Intelligence</h2>${filterBar("draft")}
    <div class=notice><b>Draft-Day Grade and Current Outcome are separated.</b> Because we do not yet have a compliant historical ADP snapshot source, the grade uses slot expectation + roster fit, while the current outcome shows today's market value. The app does not pretend current values were known on draft day.</div>
    <div class=draft-summary-grid>
      ${best?`<div class=draft-summary-card><div class=draft-rank>Best Current Draft Outcome</div><h3>${esc(best._manager)}</h3><div class=draft-score>${draftGradeForPick(best).grade}</div><div class=muted>${esc(player(best.player_id).full_name||best.player_id)} • Pick ${best.pick_no} • ${best._season}</div></div>`:""}
      ${worst?`<div class=draft-summary-card><div class=draft-rank>Lowest Current Draft Outcome</div><h3>${esc(worst._manager)}</h3><div class=draft-score>${draftGradeForPick(worst).grade}</div><div class=muted>${esc(player(worst.player_id).full_name||worst.player_id)} • Pick ${worst.pick_no} • ${worst._season}</div></div>`:""}
    </div>
    <h2 style="margin-top:18px">Manager Draft Rankings</h2>
    <div class=draft-summary-grid>${summaries.map((x,i)=>`<div class=draft-summary-card><div class=draft-rank>#${i+1} • ${esc(x.season)}</div><h3>${esc(x.name)}</h3><div class=draft-score>${Math.round(x.score)} <span class=grade>${grade(x.score)}</span></div><div class=muted>${x.count} graded pick${x.count===1?"":"s"}</div></div>`).join("")}</div>
    ${_fd.slice().sort((a,b)=>String(b.season).localeCompare(String(a.season))).map(d=>`<div style="margin-top:22px"><h2>${esc(d.season)} Draft</h2><div class=draft-board>${d.picks.slice().sort((a,b)=>(a.pick_no||0)-(b.pick_no||0)).map(p=>{const g=draftGradeForPick(p),name=d.managerName(p.roster_id);return `<div class=draft-pick><div class=draft-head><div><span class=pick-badge>Pick ${p.pick_no??"—"}</span><h3>${esc(player(p.player_id).full_name||market(p.player_id).name||p.player_id)}</h3><div class=muted>${esc(name)} • ${esc(pos(p.player_id))}</div></div><div class=draft-grade>${g.grade}</div></div><div class=draft-metrics><div class=draft-metric><small>Draft Score</small><b>${Math.round(g.score)}/100</b></div><div class=draft-metric><small>Expected Slot Value</small><b>${fmt(g.expected)}</b></div><div class=draft-metric><small>Current Market</small><b>${fmt(g.actual)}</b></div><div class=draft-metric><small>Value vs Slot</small><b class="${g.delta>=0?"delta-pos":"delta-neg"}">${g.delta>=0?"+":""}${Math.round(g.delta)}%</b></div></div><div class=draft-note>${esc(draftReason(p,g))}</div></div>`}).join("")}</div></div>`).join("")}
  </div>`;
}
function renderHistory(){return `<div class=panel><h2>League History</h2>${S.seasons.map((s,i)=>`<p><b>${esc(s.season)}</b>${i===0?" — Current":""} • ${s.trades} trades • previous league: ${esc(s.previous||"None")}</p>`).join("")}</div>`}
function renderGrades(){return `<div class=panel><h2>V2.6 Analytics Models</h2><p><b>Trade Grade:</b> market edge, roster need, age/team window and package structure.</p><p><b>Dynasty Team Score:</b> 35% total roster value, 30% optimized starters, 20% future draft capital, 15% youth.</p><p><b>Draft Grade:</b> expected value for the draft slot + roster fit, with current market outcome shown separately.</p><p><b>Overall GM / Legacy Score:</b> 60% historical performance, 25% draft success and 15% trade success.</p><p><b>Position Strength:</b> each team's QB/RB/WR/TE value is compared against the league to generate a percentile.</p><p><b>Dynasty Window:</b> Win Now, Contender, Competitive, Ascending, Rebuilding or Reset Needed based on value, starters, youth and picks.</p><div class=notice>These are league-relative analytics, not guarantees of future fantasy performance.</div></div>`}
function render(){
  let html={overview:renderOverview,trades:()=>renderTrades()+renderTradePower(),draft:renderDraft,rosters:renderRosters,history:renderHistory,legacy:renderLegacy,grades:renderGrades}[S.tab]?.()||renderOverview();
  $("#app").innerHTML=html;
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===S.tab));if(S.tab==="trades")bindFilters("trade");if(S.tab==="draft")bindFilters("draft");if(S.tab==="rosters")document.querySelectorAll(".team-select-btn").forEach(b=>b.onclick=()=>{S.selectedTeam=Number(b.dataset.rid);render()});
}
async function sync(){
  let st=$("#status");st.textContent="Syncing current and historical league data…";
  try{
    S.league=await get(`${API}/league/${LEAGUE_ID}`);S.users=await get(`${API}/league/${LEAGUE_ID}/users`);S.rosters=await get(`${API}/league/${LEAGUE_ID}/rosters`);S.drafts=await get(`${API}/league/${LEAGUE_ID}/drafts`);
    try{S.tradedPicks=await get(`${API}/league/${LEAGUE_ID}/traded_picks`)}catch{S.tradedPicks=[]}
    S.players=await cache("dhq_players",`${API}/players/nfl`);await loadProjectionData();
    S.market={};try{let raw=await cache("dhq_market",MARKET_URL);for(let x of(Array.isArray(raw)?raw:(raw.players||[])))if(x.sleeper_id!=null)S.market[x.sleeper_id]=x}catch{}
    S.trades=[];S.seasons=[];let id=LEAGUE_ID;for(let i=0;i<HISTORY_MAX&&id;i++){let s=await loadSeason(id);if(!s)break;id=s.previous};await loadHistoricalDrafts()
    st.textContent=`Synced • ${S.rosters.length} teams • ${S.trades.length} trades • ${S.historicalDrafts.reduce((n,d)=>n+d.picks.length,0)} draft picks • ${S.seasons.length} seasons`;
    render();
  }catch(e){st.textContent=`Sync failed: ${e.message}`}
}
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;render()});
$("#sync").onclick=sync;
render();sync();
