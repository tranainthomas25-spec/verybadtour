/* VeryBadTour – mise à jour automatique
   Sources : classement officiel BWF (API extranet-lv) + calendrier et tableaux Wikipédia. */
(function(){
const BWF = "https://extranet-lv.bwfbadminton.com/api/vue-rankingtable";
const WIKI = "https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&origin=*&page=";
const CATS = {SH:[6,false], SD:[7,false], DH:[8,true], DD:[9,true], DM:[10,true]};
const SECT = {"Men's singles":"SH","Women's singles":"SD","Men's doubles":"DH","Women's doubles":"DD","Mixed doubles":"DM"};
const HOSTS = {"hong kong":"HKG","china":"CHN","japan":"JPN","south korea":"KOR","korea":"KOR","malaysia":"MAS","indonesia":"INA","india":"IND",
  "thailand":"THA","singapore":"SGP","chinese taipei":"TPE","taiwan":"TPE","denmark":"DEN","france":"FRA","england":"ENG","united kingdom":"ENG",
  "germany":"GER","switzerland":"SUI","spain":"ESP","canada":"CAN","united states":"USA","australia":"AUS","macau":"MAC","vietnam":"VIE",
  "finland":"FIN","netherlands":"NED","new zealand":"NZL","philippines":"PHI","sweden":"SWE","arctic":"FIN"};
const MOIS = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
const ROUNDS = {"First round":"1er tour","Second round":"2e tour","Quarter-finals":"Quart","Semi-finals":"Demi","Final":"Finale",
  "Round of 64":"1er tour","Round of 32":"1er tour","Round of 16":"2e tour"};
const H = 3600e3;

const ls = {get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};

/* ---------- noms ---------- */
function clean(s){ return String(s||"").replace(/æ/gi,"ae").replace(/ø/gi,"o").replace(/å/gi,"a").replace(/ß/g,"ss")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\(.*?\)/g," "); }
function toks(s){ return clean(s).replace(/[^a-z]+/g," ").trim().split(/\s+/).filter(Boolean); }
const anaOf = s => toks(s).join("").split("").sort().join("");
function pretty(s){ return s.replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim()
  .split(" ").map(w=> w===w.toUpperCase() && w.length>1 ? w[0]+w.slice(1).toLowerCase() : w).join(" "); }
function letterDist(a,b){ // différence entre deux multi-ensembles de lettres (chaînes triées)
  let i=0,j=0,d=0; while(i<a.length&&j<b.length){ if(a[i]===b[j]){i++;j++;} else if(a[i]<b[j]){i++;d++;} else {j++;d++;} }
  return d+(a.length-i)+(b.length-j); }

/* ---------- classements BWF ---------- */
async function fetchRank(d){
  const [cat,dbl]=CATS[d]; const rows=[];
  for(let page=1; page<=2; page++){
    const r = await fetch(`${BWF}?rankId=2&catId=${cat}&publicationId=0&doubles=${dbl}&searchKey=&pageKey=500&page=${page}&drawCount=1`);
    if(!r.ok) throw new Error("BWF "+r.status);
    const j = await r.json();
    j.results.data.forEach(x=>rows.push({r:x.rank, p:Math.round(+x.points),
      a:pretty(x.player1_model?.name_display_bold||""), b:x.player2_model?pretty(x.player2_model.name_display_bold||""):null}));
    if(page>=j.results.last_page) break;
  }
  return rows;
}
async function rankings(force){
  const c = ls.get("vbt_rank");
  if(!force && c && Date.now()-c.ts < 12*H) return c;
  const data={};
  for(const d of Object.keys(CATS)) data[d]=await fetchRank(d);
  const out={ts:Date.now(), data}; ls.set("vbt_rank",out); return out;
}
function buildIndex(rows){
  const exact=new Map(), best=new Map(), players=new Map();
  const addP=n=>{ const a=anaOf(n); if(!players.has(a)) players.set(a,{a, t:toks(n)}); return a; };
  rows.forEach(x=>{
    const ka=addP(x.a);
    if(x.b){ const kb=addP(x.b); const k=[ka,kb].sort().join("|");
      if(!exact.has(k)) exact.set(k,x);
      [ka,kb].forEach(kk=>{ if(!best.has(kk)||best.get(kk).p<x.p) best.set(kk,x); });
    } else if(!exact.has(ka)) exact.set(ka,x);
  });
  return {exact, best, players:[...players.values()]};
}
const keyCache=new Map();
function playerKey(idx, name){
  const a=anaOf(name); if(idx.exact.has(a)||idx.best.has(a)) return a;
  const ck=idx.players.length+"|"+a; if(keyCache.has(ck)) return keyCache.get(ck);
  const t=toks(name); let res=a;
  // 1) tous les mots du nom Wikipédia se retrouvent dans le nom BWF (ex. « Line Kjærsfeldt »)
  let c=idx.players.filter(p=>t.every(w=>p.t.includes(w)));
  if(c.length!==1){ // 2) mêmes mots une fois collés (ex. « Yanzhe » / « Yan Zhe »)
    const j=t.join(""); c=idx.players.filter(p=>{ const pj=p.t.join(""); return t.every(w=>pj.includes(w)) && Math.abs(pj.length-j.length)<=4 && p.t.some(w=>t.includes(w)); }); }
  if(c.length!==1){ // 3) orthographe proche (1 lettre d'écart), même nom de famille
    c=idx.players.filter(p=>letterDist(p.a,a)<=2 && p.t.some(w=>t.includes(w))); }
  if(c.length===1) res=c[0].a;
  keyCache.set(ck,res); return res;
}
function lookup(idx, players){
  if(players.length===1){
    const x=idx.exact.get(playerKey(idx,players[0]));
    return x ? {p:x.p, r:x.r, est:false} : {p:15000, r:null, est:true, why:"hors classement"};
  }
  const ks=players.slice(0,2).map(n=>playerKey(idx,n)); const x=idx.exact.get([...ks].sort().join("|"));
  if(x) return {p:x.p, r:x.r, est:false};
  const bs=ks.map(k=>idx.best.get(k)?.p||12000);
  return {p:Math.round((bs[0]+bs[1])/2*0.85), r:null, est:true, why:"paire récente"};
}

/* ---------- calendrier ---------- */
async function wikitext(page){
  const r=await fetch(WIKI+encodeURIComponent(page)); if(!r.ok) throw new Error("Wiki "+r.status);
  const j=await r.json(); if(j.error) throw new Error(j.error.info); return j.parse.wikitext;
}
async function calendar(force){
  const year=new Date().getFullYear();
  const c=ls.get("vbt_cal");
  if(!force && c && c.year===year && Date.now()-c.ts<12*H) return c.events;
  const w=await wikitext(`${year} BWF World Tour`);
  const ev=[]; const re=/\|\s*(\d{1,2})(?:\s+([A-Z][a-z]+))?\s*[–-]\s*(\d{1,2})\s+([A-Z][a-z]+)\s*\n([\s\S]{0,400}?)\[\[([^\]|]+)\|Draw\]\]([\s\S]{0,700}?)\n\|/g;
  let m; while((m=re.exec(w))){
    const [ ,d1,m1,d2,m2,mid,page,rest]=m; const blk=mid+rest;
    const nm=(mid.match(/'''\[\[(?:[^\]|]*\|)?([^\]]+)\]\]'''/)||[])[1] || page.replace(/^\d{4}\s*/,"").replace(/\s*\(badminton\)/,"");
    const lvl=(blk.match(/Level:'''\s*([^\n]+)/)||[])[1]||"";
    const host=((blk.match(/Host:'''\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/)||[])[1]||"").trim();
    const end=MOIS[m2]; if(end===undefined) continue; const start=m1?MOIS[m1]:end;
    ev.push({name:nm.trim(), page, level:lvl.replace(/\[\[|\]\]|'''/g,"").trim(), host,
      start:new Date(year,start,+d1).getTime(), end:new Date(year,end,+d2,23,59).getTime()});
  }
  ls.set("vbt_cal",{ts:Date.now(),year,events:ev}); return ev;
}
function pickEvents(ev){
  const now=Date.now(), day=24*H;
  const cur=ev.filter(e=>e.start-day<=now && now<=e.end+12*H);
  if(cur.length) return cur;
  const next=ev.filter(e=>e.start>now).sort((a,b)=>a.start-b.start);
  const prev=ev.filter(e=>e.end<now).sort((a,b)=>b.end-a.end);
  return [...next.slice(0,2), ...prev.slice(0,1)];
}
function levelCoef(l){ if(/1000|750|Finals/i.test(l)) return 1; if(/500/.test(l)) return 0.95; if(/300/.test(l)) return 0.9; return 0.85; }

/* ---------- tableaux ---------- */
function parseTeam(v){
  if(!v) return null;
  const players=[...v.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(m=>m[1].replace(/\s*\(.*?\)\s*/g,"").trim());
  if(!players.length) return null;
  const flags=[...v.matchAll(/flagicon\|([A-Z]{3})/g)].map(m=>m[1]);
  return {players, flags, bold:/'''/.test(v)};
}
function parseBracket(body){
  const P={}; ("\n"+body).split(/\n\s*\|/).forEach(l=>{ const i=l.indexOf("="); if(i>0) P[l.slice(0,i).trim()]=l.slice(i+1).trim(); });
  const out=[];
  for(let r=1; P["RD"+r]!==undefined || P["RD"+r+"-team1"]!==undefined; r++){
    const label=(P["RD"+r]||"").replace(/'''/g,"").trim();
    for(let n=1; P[`RD${r}-team${n}`]!==undefined; n+=2){
      const A=parseTeam(P[`RD${r}-team${n}`]), B=parseTeam(P[`RD${r}-team${n+1}`]);
      const sc=k=>[1,2,3].map(g=>(P[`RD${r}-score${k}-${g}`]||"").replace(/'''/g,"").trim()).filter(Boolean);
      const sA=sc(n), sB=sc(n+1);
      out.push({label, A, B, sA, sB, seedA:(P[`RD${r}-seed${n}`]||"").replace(/&nbsp;/g,"").trim(), seedB:(P[`RD${r}-seed${n+1}`]||"").replace(/&nbsp;/g,"").trim()});
    }
  }
  return out;
}
function winnerOf(m){
  if(!m.A||!m.B) return null;
  if(m.A.bold && !m.B.bold) return "A"; if(m.B.bold && !m.A.bold) return "B";
  if(!m.sA.length && !m.sB.length) return null;
  let a=0,b=0; m.sA.forEach((x,i)=>{ const y=+m.sB[i]; if(+x>y) a++; else if(y>+x) b++; });
  return a>=2?"A":b>=2?"B":null;
}
async function draw(ev, force){
  const ck="vbt_draw_"+ev.page; const c=ls.get(ck);
  if(!force && c && Date.now()-c.ts<20*60e3) return c.matches;
  const w=await wikitext(ev.page);
  const parts=w.split(/^==\s*([^=\n]+?)\s*==\s*$/m);
  const matches=[];
  for(let i=1;i<parts.length;i+=2){
    const d=SECT[parts[i].trim()]; if(!d) continue;
    const re=/\{\{\s*\d+TeamBracket[^\n]*\n([\s\S]*?)\n\s*\}\}/g; let m;
    while((m=re.exec(parts[i+1]))){
      parseBracket(m[1]).forEach(x=>{
        if(!x.A||!x.B) return;
        const win=winnerOf(x);
        matches.push({disc:d, round:ROUNDS[x.label]||x.label, A:x.A, B:x.B, sA:x.sA, sB:x.sB, seedA:x.seedA, seedB:x.seedB, win,
          done: !!win || (x.sA.length>0 && /w\/o|ret|r$/i.test(x.sA.concat(x.sB).join(" ")))});
      });
    }
  }
  ls.set(ck,{ts:Date.now(),matches}); return matches;
}

/* ---------- assemblage ---------- */
const ORDER=["1er tour","2e tour","Quart","Demi","Finale"];
async function load(opts={}){
  const [rk, ev] = await Promise.all([rankings(opts.force), calendar(opts.force)]);
  const events = pickEvents(ev);
  const evSel = events.find(e=>e.page===opts.page) || events[0];
  if(!evSel) return {events, error:"Aucun tournoi trouvé dans le calendrier."};
  const raw = await draw(evSel, opts.force);
  const idx={}; Object.keys(CATS).forEach(d=>idx[d]=buildIndex(rk.data[d]));
  const host = HOSTS[(evSel.host||"").toLowerCase()] || null;
  const coef = levelCoef(evSel.level);
  const tname = t => t.players.join(" / ") + (t.flags[0]?` (${t.flags[0]})`:"");
  const sideKey = t => t.players.join("|");
  // historique de chaque joueur dans le tournoi (forme + fatigue)
  const hist = {};
  raw.filter(m=>m.done&&m.win).sort((a,b)=>ORDER.indexOf(a.round)-ORDER.indexOf(b.round)).forEach(m=>{
    const games=Math.max(m.sA.length,m.sB.length);
    [["A",m.A],["B",m.B]].forEach(([s,t])=>{ (hist[sideKey(t)] ||= []).unshift({won:m.win===s, games}); });
  });
  const matches = raw.map(m=>{
    const la=lookup(idx[m.disc], m.A.players), lb=lookup(idx[m.disc], m.B.players);
    const homeA = host && m.A.flags.includes(host), homeB = host && m.B.flags.includes(host);
    const hA=hist[sideKey(m.A)]||[], hB=hist[sideKey(m.B)]||[];
    // pour un match à venir, seul le passé compte ; pour un match fini on ne recalcule pas la forme
    const fat = h => !h.length ? 0 : (h[0].games>=3 ? -25 : 0);
    const notes=[]; if(la.est) notes.push(`${m.A.players.join("/")} : ${la.why}, points estimés`); if(lb.est) notes.push(`${m.B.players.join("/")} : ${lb.why}, points estimés`);
    return {disc:m.disc, round:m.round, done:m.done, win:m.win,
      score: m.done ? m.sA.map((x,i)=>`${x}-${m.sB[i]??""}`).join(" ") : "",
      A:tname(m.A)+(m.seedA&&/^\d+$/.test(m.seedA)?` [${m.seedA}]`:""), B:tname(m.B)+(m.seedB&&/^\d+$/.test(m.seedB)?` [${m.seedB}]`:""),
      ptsA:la.p, ptsB:lb.p, rankA:la.r, rankB:lb.r,
      home: homeA&&!homeB?"A":homeB&&!homeA?"B":"0",
      fatA: m.done?0:fat(hA), fatB: m.done?0:fat(hB),
      formA: m.done?[]:hA.slice(0,5).map(x=>x.won?"V":"D"), formB: m.done?[]:hB.slice(0,5).map(x=>x.won?"V":"D"),
      note: notes.join(" · ")};
  });
  return {events, ev:evSel, coef, host, matches, rankTs:rk.ts, ts:Date.now(), rank:rk};
}
window.VBT_AUTO = {load, rankings};
})();
