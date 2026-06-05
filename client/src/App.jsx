import { useState, useEffect, useCallback } from "react";
import { login as apiLogin, setToken, fetchVentas, getUsers, getRoles, saveUser, removeUser, saveRole, fetchVariaciones } from "./api";

const SUCURSALES = ["24SET","MENDO","MUÑE","SAL"];
const SUC_COLORS = { "24SET":"#4ade80","MENDO":"#60a5fa","MUÑE":"#facc15","SAL":"#f87171" };
const VISTAS_INFO = { diario:{icon:"📅",label:"Diario"}, montos:{icon:"💰",label:"Montos"}, metricas:{icon:"📈",label:"Métricas"} };
const RATIO_TICKET = { "24SET":1.0018, "MENDO":1.0068, "MUÑE":1.0130, "SAL":1.0060 };

const fmt  = n => Math.round(n||0).toLocaleString("es-AR");
const fmtM = n => { n=n||0; return n>=1e6?"$"+(n/1e6).toFixed(2)+"M":n>=1e3?"$"+(n/1e3).toFixed(0)+"K":"$"+fmt(n); };
const fmtPesos = n => "$"+(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});
const pct  = (a,b) => b ? (((a-b)/b)*100) : null;
const sign = v => v===null?"—":(v>=0?"+":"")+v.toFixed(1)+"%";
const signColor = v => v===null?"#64748b":v>=0?"#4ade80":"#f87171";
const parseNum = s => parseFloat((s||"0").replace(/\*+/g,"").replace(/\./g,"").replace(",",".").trim())||0;

// Fecha y hora de Argentina, robusto ante cualquier zona horaria del navegador/servidor
const today   = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/Argentina/Buenos_Aires"}).format(new Date());
const ahoraArg = () => {
  const p = new Intl.DateTimeFormat("en-GB",{timeZone:"America/Argentina/Buenos_Aires",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  const h=+p.find(x=>x.type==="hour").value, m=+p.find(x=>x.type==="minute").value;
  return { min:h*60+m, str:`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}` };
};

// Mensaje motivacional según cumplimiento de meta y franja horaria (Argentina)
// meta = referencia del año anterior (mismo día de la semana). cumplido = unidades de hoy.
function metaMensaje(cumplido, meta){
  if(!meta || meta<=0) return null;
  const faltante = Math.max(0,(1 - cumplido/meta) * 100); // % que falta para llegar a la meta
  const min = ahoraArg().min;
  // Hasta las 17:15 y falta 60% o menos (se activa al alcanzar el ritmo, típicamente cerca de las 13:15)
  if(min<=1035 && faltante<=60) return "Vamos bien. Es totalmente posible lograr la meta diaria !!!";
  // 18:00–19:00 y falta 70% o menos
  if(min>=1080 && min<=1140 && faltante<=70) return "Así se hace !!! vamos por el 100%";
  return null;
}

const addDays = (s,n)=>{ const d=new Date(s); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const fmtDate = iso => { const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; };
const dayName = iso => new Date(iso+"T12:00:00").toLocaleDateString("es-AR",{weekday:"long"});
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);

function rowCells(line){ return line.split("|").map(c=>c.replace(/\*/g,"").trim()).filter((c,i,arr)=>!(i===0&&c==="")&&!(i===arr.length-1&&c==="")); }
function tableRows(text){
  const lines=(text||"").split("\n").map(l=>l.trim()).filter(l=>l.includes("|"));
  const out=[];
  for(const line of lines){ if(/^\|?[\s:|-]+\|?$/.test(line))continue; const c=rowCells(line); if(c.length)out.push(c); }
  return out;
}
function parseUnidades(text){
  const map={};
  tableRows(text).forEach(c=>{ const s=(c[0]||"").trim(); if(SUCURSALES.includes(s)) map[s]={tipo1:parseNum(c[1]),tipo2:parseNum(c[2]),total:parseNum(c[3])}; });
  return map;
}
function parseMontos(text){
  const grab=(label)=>{
    const re=new RegExp(label+":\\s*(\\d+)\\s*l.neas?,\\s*([\\d.,]+)\\s*u\\.?,\\s*\\$\\s*([\\d.,]+)[^$]*\\(util\\.\\s*\\$\\s*([\\d.,]+)","i");
    const m=(text||"").match(re);
    return m?{lineas:parseNum(m[1]),unidades:parseNum(m[2]),importe:parseNum(m[3]),util:parseNum(m[4])}:{lineas:0,unidades:0,importe:0,util:0};
  };
  return { tipo1:grab("Tipo 1"), tipo2:grab("Tipo 2"), total:grab("Total") };
}

async function getUnidadesDia(fecha, sucursales){
  const res = await fetchVentas({ action:"unidades_sucursal_tipo", fecha_desde:fecha, fecha_fin:fecha, sucursales });
  const raw = res?.texto || res?.raw || (typeof res==="string"?res:"");
  return parseUnidades(raw);
}
async function getMontosSuc(fecha, suc){
  const res = await fetchVentas({ action:"montos_por_tipo", fecha_desde:fecha, fecha_fin:fecha, sucursales:suc });
  const raw = res?.texto || res?.raw || (typeof res==="string"?res:"");
  return parseMontos(raw);
}

export default function App(){
  const [roles,setRoles]   = useState(null);
  const [auth,setAuth]     = useState(null);
  const [lu,setLu]         = useState("");
  const [lp,setLp]         = useState("");
  const [verPass,setVerPass] = useState(false);
  const [loginErr,setLoginErr] = useState("");
  const [vista,setVista]   = useState("diario");
  const [fecha,setFecha]   = useState(today());

  const [loading,setLoading] = useState(false);
  const [step,setStep]     = useState("");
  const [error,setError]   = useState("");
  const [data,setData]     = useState(null);
  const [ultimaAct,setUltimaAct] = useState(null);
  const [, setTick]        = useState(0);
  const [esMovil,setEsMovil] = useState(typeof window!=="undefined" && window.innerWidth<700);

  useEffect(()=>{
    const onResize=()=>setEsMovil(window.innerWidth<700);
    window.addEventListener("resize",onResize);
    return ()=>window.removeEventListener("resize",onResize);
  },[]);

  // Re-evalúa la hora cada minuto (para mostrar/ocultar los mensajes de meta a tiempo)
  useEffect(()=>{
    const t=setInterval(()=>setTick(x=>x+1), 60*1000);
    return ()=>clearInterval(t);
  },[]);

  const isAdmin = auth?.role==="admin";
  const miRol = (roles && auth) ? roles[auth.role] : null;
  const misVistas = miRol?.vistas || ["diario"];
  const puedeVerMontos = isAdmin || !!miRol?.verMontos;

  async function handleLogin(){
    setLoginErr("");
    const r = await apiLogin(lu.trim(), lp);
    if(!r.ok){ setLoginErr(r.error||"Error"); return; }
    setToken(r.token);
    setAuth({ user:lu.trim().toLowerCase(), role:r.role, sucursal:r.sucursal, label:r.label });
    const rr = await getRoles();
    if(rr.ok) setRoles(rr.roles);
    const rolVistas = rr.ok ? (rr.roles[r.role]?.vistas||["diario"]) : ["diario"];
    setVista(rolVistas[0]||"diario");
  }

  const load = useCallback(async()=>{
    if(!auth) return;
    setLoading(true); setError(""); setData(null);
    const suc = auth.role==="encargado" ? auth.sucursal : "";
    const fechaRef = addDays(fecha,-364);
    try {
      setStep("Cargando unidades…");
      const [uHoy,uRef] = await Promise.all([ getUnidadesDia(fecha,suc), getUnidadesDia(fechaRef,suc) ]);

      let variaciones = null;
      if(auth.role==="encargado"){
        try { const r = await fetchVariaciones(fecha, fechaRef); if(r.ok) variaciones = r.variaciones; } catch(e){}
      }

      let montosHoy={}, montosRef={};
      if(vista==="montos"||vista==="metricas"){
        setStep("Cargando montos…");
        const sucs = auth.role==="encargado" ? [auth.sucursal] : SUCURSALES;
        for(const s of sucs){
          montosHoy[s] = await getMontosSuc(fecha,s);
          montosRef[s] = await getMontosSuc(fechaRef,s);
        }
      }
      setData({ uHoy, uRef, montosHoy, montosRef, fechaRef, variaciones });
      setUltimaAct(ahoraArg().str);
    } catch(e){ setError(e.message); }
    setLoading(false); setStep("");
  },[auth,fecha,vista]);

  useEffect(()=>{ if(auth) load(); },[auth,fecha,vista]);

  // Auto-actualización cada 10 minutos
  useEffect(()=>{
    if(!auth) return;
    const interval=setInterval(()=>{ setFecha(today()); load(); }, 10*60*1000);
    return ()=>clearInterval(interval);
    // eslint-disable-next-line
  },[auth]);

  if(!auth) return (
    <div style={{minHeight:"100vh",background:"#0f172a",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,sans-serif"}}>
      <div style={{background:"#1e293b",border:"1px solid #334155",borderRadius:16,padding:"2rem",width:300}}>
        <div style={{marginBottom:"1.5rem",textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:8}}>📊</div>
          <div style={{fontSize:20,fontWeight:600,color:"#f1f5f9",marginBottom:4}}>Dashboard ventas</div>
          <div style={{fontSize:13,color:"#94a3b8"}}>La Sorpresa</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <input placeholder="Usuario" value={lu} onChange={e=>setLu(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            style={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"8px 12px",color:"#f1f5f9",fontSize:14,outline:"none"}}/>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <input type={verPass?"text":"password"} placeholder="Contraseña" value={lp} onChange={e=>setLp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              style={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"8px 38px 8px 12px",color:"#f1f5f9",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"}}/>
            <button onClick={()=>setVerPass(v=>!v)} type="button" title={verPass?"Ocultar":"Mostrar"}
              style={{position:"absolute",right:8,background:"transparent",border:"none",cursor:"pointer",fontSize:16,padding:0,lineHeight:1}}>
              {verPass?"🙈":"👁"}
            </button>
          </div>
          {loginErr&&<div style={{fontSize:12,color:"#f87171"}}>{loginErr}</div>}
          <button onClick={handleLogin} style={{background:"#3b82f6",border:"none",borderRadius:8,padding:"10px",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",marginTop:4}}>Ingresar</button>
        </div>
      </div>
    </div>
  );

  const c = {
    page:{minHeight:"100vh",background:"#0f172a",fontFamily:"system-ui,sans-serif",color:"#f1f5f9",display:"flex",flexDirection:"column"},
    hdr:{background:"#1e293b",borderBottom:"1px solid #334155",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"},
    body:{display:"flex",flex:1},
    nav:{width:56,background:"#1e293b",borderRight:"1px solid #334155",display:"flex",flexDirection:"column",alignItems:"center",paddingTop:12,gap:2},
    main:{flex:1,padding:14,minWidth:0},
    card:{background:"#1e293b",border:"1px solid #334155",borderRadius:10,padding:14},
    lbl:{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6},
    big:{fontSize:32,fontWeight:700,lineHeight:1.1},
    sub:{fontSize:11,color:"#64748b",marginTop:4},
  };

  const tabs=[];
  ["diario","montos","metricas"].forEach(v=>{ if(misVistas.includes(v)) tabs.push(v); });
  if(isAdmin) tabs.push("usuarios");

  return (
    <div style={c.page}>
      <style>{`@keyframes metaBlink{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,0);border-color:#facc15}50%{box-shadow:0 0 14px 2px rgba(250,204,21,.55);border-color:#fde047}}`}</style>
      <div style={c.hdr}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>📊</span>
          <div>
            <div style={{fontSize:14,fontWeight:600}}>Dashboard ventas — La Sorpresa</div>
            <div style={{fontSize:11,color:"#64748b"}}>{auth.label}{auth.sucursal?" · "+auth.sucursal:""} · {cap(dayName(fecha))} {fmtDate(fecha)}{ultimaAct && <span style={{color:"#facc15"}}> · Actualizado {ultimaAct}</span>}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <button onClick={load} disabled={loading} style={{background:"#1e293b",border:"1px solid #334155",borderRadius:7,padding:"6px 12px",color:"#94a3b8",fontSize:12,cursor:"pointer"}}>↺ {loading?step||"…":"actualizar"}</button>
          <button onClick={()=>{setToken(null);setAuth(null);}} style={{background:"#dc2626",border:"none",borderRadius:7,padding:"6px 14px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>salir</button>
        </div>
      </div>

      <div style={esMovil ? {flex:1,display:"flex",flexDirection:"column"} : c.body}>
        {/* NAV LATERAL (solo PC) */}
        {!esMovil && (
          <div style={c.nav}>
            {tabs.map(t=>{
              const info = t==="usuarios" ? {icon:"👥",label:"Usuarios"} : VISTAS_INFO[t];
              return (
                <button key={t} onClick={()=>setVista(t)}
                  style={{width:50,padding:"8px 2px",background:vista===t?"#0f172a":"transparent",border:"none",
                    borderLeft:vista===t?"2px solid #3b82f6":"2px solid transparent",borderRadius:"0 6px 6px 0",cursor:"pointer",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <span style={{fontSize:18}}>{info.icon}</span>
                  <span style={{fontSize:9,color:vista===t?"#60a5fa":"#475569",textAlign:"center",lineHeight:1.1}}>{info.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{...c.main, paddingBottom: esMovil ? 76 : 14}}>
          {error&&<div style={{background:"#450a0a",border:"1px solid #7f1d1d",borderRadius:8,padding:"10px 14px",color:"#fca5a5",fontSize:12,marginBottom:12}}>{error}</div>}
          {loading&&<div style={{textAlign:"center",padding:"4rem",color:"#475569",fontSize:13}}>{step||"Cargando…"}</div>}

          {data&&!loading&&vista==="diario"   && <Diario data={data} fecha={fecha} auth={auth} c={c}/>}
          {data&&!loading&&vista==="montos"    && misVistas.includes("montos")   && <Montos data={data} fecha={fecha} auth={auth} c={c}/>}
          {data&&!loading&&vista==="metricas"  && misVistas.includes("metricas") && <Metricas data={data} fecha={fecha} auth={auth} c={c}/>}
          {vista==="usuarios" && isAdmin && roles && <AdminPanel roles={roles} setRoles={setRoles} c={c}/>}
        </div>

        {/* NAV INFERIOR (solo celular) */}
        {esMovil && (
          <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#1e293b",borderTop:"1px solid #334155",
            display:"flex",justifyContent:"space-around",padding:"6px 0",zIndex:50}}>
            {tabs.map(t=>{
              const info = t==="usuarios" ? {icon:"👥",label:"Usuarios"} : VISTAS_INFO[t];
              return (
                <button key={t} onClick={()=>setVista(t)}
                  style={{flex:1,padding:"6px 2px",background:"transparent",border:"none",cursor:"pointer",
                    display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                    borderTop:vista===t?"2px solid #3b82f6":"2px solid transparent"}}>
                  <span style={{fontSize:20}}>{info.icon}</span>
                  <span style={{fontSize:10,color:vista===t?"#60a5fa":"#94a3b8"}}>{info.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Diario({data,fecha,auth,c}){
  const esEncargado = auth.role==="encargado";
  const miSuc = auth.sucursal;
  const fechaRef = data.fechaRef;
  const hoy={}, ref={};
  SUCURSALES.forEach(s=>{ hoy[s]=data.uHoy[s]?.total||0; ref[s]=data.uRef[s]?.total||0; });

  const sucKpi = esEncargado ? [miSuc] : SUCURSALES;
  const totalHoy = sucKpi.reduce((a,s)=>a+(hoy[s]||0),0);
  const totalRef = sucKpi.reduce((a,s)=>a+(ref[s]||0),0);
  const varTotal = pct(totalHoy,totalRef);
  const mejor = SUCURSALES.reduce((a,s)=>(hoy[s]||0)>(hoy[a]||0)?s:a,SUCURSALES[0]);
  const totalGeneral = SUCURSALES.reduce((a,s)=>a+(hoy[s]||0),0);
  const totalGenRef = SUCURSALES.reduce((a,s)=>a+(ref[s]||0),0);

  // Mensaje motivacional de meta (meta = referencia del año anterior)
  const msgMeta = metaMensaje(totalHoy, totalRef);

  return (<>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:12}}>
      <div style={{...c.card,background:"#16261c",borderColor:"#22c55e"}}><div style={{...c.lbl,color:"#4ade80"}}>{esEncargado?"Unidades hoy":"Total hoy"}</div><div style={{...c.big,color:"#4ade80"}}>{fmt(totalHoy)}</div><div style={c.sub}>{cap(dayName(fecha))} · {esEncargado?miSuc:"unidades"}</div></div>
      <div style={{...c.card,background:"#1e2536",borderColor:"#475569"}}><div style={{...c.lbl,color:"#94a3b8"}}>Ref. ant.</div><div style={{...c.big,color:"#94a3b8"}}>{fmt(totalRef)}</div><div style={c.sub}>{fmtDate(fechaRef)}</div></div>
      <div style={c.card}><div style={c.lbl}>Variación</div><div style={{...c.big,color:signColor(varTotal)}}>{sign(varTotal)}</div><div style={c.sub}>{(totalHoy-totalRef>=0?"+":"")+fmt(totalHoy-totalRef)} u</div></div>
      {!esEncargado && <div style={c.card}><div style={c.lbl}>Mejor local</div><div style={{...c.big,fontSize:22,color:SUC_COLORS[mejor]}}>{mejor}</div><div style={c.sub}>{fmt(hoy[mejor])} u</div></div>}
      {msgMeta && (
        <div style={{...c.card,border:"2px solid #facc15",animation:"metaBlink 1.4s ease-in-out infinite",display:"flex",flexDirection:"column",justifyContent:"center",minWidth:160}}>
          <div style={{...c.lbl,color:"#facc15"}}>Meta del día</div>
          <div style={{fontSize:15,fontWeight:700,color:"#fde047",lineHeight:1.3}}>{msgMeta}</div>
        </div>
      )}
    </div>

    <div style={c.card}>
      <div style={{...c.lbl,marginBottom:10}}>Comparación de unidades por local — {fmtDate(fecha)} vs {fmtDate(fechaRef)}</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{color:"#475569",fontSize:10,textTransform:"uppercase"}}>
          <td style={{padding:"7px 8px"}}>Local</td><td style={{padding:"7px 8px",textAlign:"right"}}>Hoy</td>
          <td style={{padding:"7px 8px",textAlign:"right"}}>Ref. ant.</td><td style={{padding:"7px 8px",textAlign:"right"}}>Dif.</td>
          <td style={{padding:"7px 8px",textAlign:"right"}}>Var.</td>
        </tr></thead>
        <tbody>
          {SUCURSALES.map(suc=>{
            const h=hoy[suc]||0,a=ref[suc]||0,col=SUC_COLORS[suc];
            const oculto = esEncargado && suc!==miSuc; const G="—";
            const v = oculto ? (data.variaciones?.[suc] ?? null) : pct(h,a);
            return (
              <tr key={suc} style={{borderTop:"1px solid #0f172a",opacity:oculto?0.7:1}}>
                <td style={{padding:"9px 8px"}}><span style={{display:"inline-flex",alignItems:"center",gap:7}}><span style={{width:8,height:8,borderRadius:"50%",background:col}}/><span style={{fontWeight:500}}>{suc}</span></span></td>
                <td style={{padding:"9px 8px",textAlign:"right",fontWeight:600,fontSize:14,color:oculto?"#475569":"#f1f5f9"}}>{oculto?G:fmt(h)}</td>
                <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{oculto?G:fmt(a)}</td>
                <td style={{padding:"9px 8px",textAlign:"right",color:oculto?"#475569":signColor(v)}}>{oculto?G:((h-a>=0?"+":"")+fmt(h-a))}</td>
                <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700}}>{sign(v)}</td>
              </tr>
            );
          })}
          {!esEncargado&&(
            <tr style={{borderTop:"1px solid #334155"}}>
              <td style={{padding:"9px 8px",color:"#94a3b8",fontWeight:600}}>TOTAL</td>
              <td style={{padding:"9px 8px",textAlign:"right",fontWeight:700,color:"#facc15",fontSize:14}}>{fmt(totalGeneral)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{fmt(totalGenRef)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(pct(totalGeneral,totalGenRef))}}>{totalGeneral-totalGenRef>=0?"+":""}{fmt(totalGeneral-totalGenRef)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(pct(totalGeneral,totalGenRef)),fontWeight:700}}>{sign(pct(totalGeneral,totalGenRef))}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </>);
}

function Montos({data,fecha,auth,c}){
  const fechaRef=data.fechaRef;
  const ivaSuc=m=>m?(m.tipo1.importe*1.21+m.tipo2.importe):0;
  const hoy={},ref={};
  SUCURSALES.forEach(s=>{ hoy[s]=ivaSuc(data.montosHoy[s]); ref[s]=ivaSuc(data.montosRef[s]); });
  const totalHoy=SUCURSALES.reduce((a,s)=>a+hoy[s],0);
  const totalRef=SUCURSALES.reduce((a,s)=>a+ref[s],0);
  const varTotal=pct(totalHoy,totalRef);
  const mejor=SUCURSALES.reduce((a,s)=>hoy[s]>hoy[a]?s:a,SUCURSALES[0]);

  return (<>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:12}}>
      <div style={{...c.card,background:"#16261c",borderColor:"#22c55e"}}><div style={{...c.lbl,color:"#4ade80"}}>Total c/IVA hoy</div><div style={{...c.big,color:"#4ade80"}}>{fmtM(totalHoy)}</div><div style={c.sub}>{cap(dayName(fecha))} · {fmtDate(fecha)}</div></div>
      <div style={{...c.card,background:"#1e2536",borderColor:"#475569"}}><div style={{...c.lbl,color:"#94a3b8"}}>Ref. ant.</div><div style={{...c.big,color:"#94a3b8"}}>{fmtM(totalRef)}</div><div style={c.sub}>{fmtDate(fechaRef)}</div></div>
      <div style={c.card}><div style={c.lbl}>Variación</div><div style={{...c.big,color:signColor(varTotal)}}>{sign(varTotal)}</div><div style={c.sub}>{(totalHoy-totalRef>=0?"+":"")+fmtM(totalHoy-totalRef)}</div></div>
      <div style={c.card}><div style={c.lbl}>Mejor local</div><div style={{...c.big,fontSize:22,color:SUC_COLORS[mejor]}}>{mejor}</div><div style={c.sub}>{fmtM(hoy[mejor])}</div></div>
    </div>

    <div style={c.card}>
      <div style={{...c.lbl,marginBottom:10}}>Comparación de montos por local — {fmtDate(fecha)} vs {fmtDate(fechaRef)}</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{color:"#475569",fontSize:10,textTransform:"uppercase"}}>
          <td style={{padding:"7px 8px"}}>Local</td><td style={{padding:"7px 8px",textAlign:"right"}}>Hoy c/IVA</td>
          <td style={{padding:"7px 8px",textAlign:"right"}}>Ref. ant.</td><td style={{padding:"7px 8px",textAlign:"right"}}>Dif.</td>
          <td style={{padding:"7px 8px",textAlign:"right"}}>Var.</td>
        </tr></thead>
        <tbody>
          {SUCURSALES.map(suc=>{
            const h=hoy[suc],a=ref[suc],v=pct(h,a),col=SUC_COLORS[suc];
            return (
              <tr key={suc} style={{borderTop:"1px solid #0f172a"}}>
                <td style={{padding:"9px 8px"}}><span style={{display:"inline-flex",alignItems:"center",gap:7}}><span style={{width:8,height:8,borderRadius:"50%",background:col}}/><span style={{fontWeight:500}}>{suc}</span></span></td>
                <td style={{padding:"9px 8px",textAlign:"right",fontWeight:600,fontSize:14}}>{fmtM(h)}</td>
                <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{fmtM(a)}</td>
                <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v)}}>{h-a>=0?"+":""}{fmtM(h-a)}</td>
                <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700}}>{sign(v)}</td>
              </tr>
            );
          })}
          <tr style={{borderTop:"1px solid #334155"}}>
            <td style={{padding:"9px 8px",color:"#94a3b8",fontWeight:600}}>TOTAL</td>
            <td style={{padding:"9px 8px",textAlign:"right",fontWeight:700,color:"#facc15",fontSize:14}}>{fmtM(totalHoy)}</td>
            <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{fmtM(totalRef)}</td>
            <td style={{padding:"9px 8px",textAlign:"right",color:signColor(varTotal)}}>{totalHoy-totalRef>=0?"+":""}{fmtM(totalHoy-totalRef)}</td>
            <td style={{padding:"9px 8px",textAlign:"right",color:signColor(varTotal),fontWeight:700}}>{sign(varTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </>);
}

function Metricas({data,fecha,auth,c}){
  const fechaRef=data.fechaRef;
  const tickets=(m,suc)=>{ const lin=m?(m.tipo1.lineas+m.tipo2.lineas):0; return Math.round(lin/(RATIO_TICKET[suc]||1)); };
  const ivaSuc=m=>m?(m.tipo1.importe*1.21+m.tipo2.importe):0;
  const sucList = auth.role==="encargado" ? [auth.sucursal] : SUCURSALES;

  const filas=sucList.map(suc=>{
    const mH=data.montosHoy[suc], mR=data.montosRef[suc];
    const tkH=tickets(mH,suc), tkR=tickets(mR,suc);
    const uH=data.uHoy[suc]?.total||0, uR=data.uRef[suc]?.total||0;
    return { suc, tkH, tkR,
      uxtH: tkH?uH/tkH:0, uxtR: tkR?uR/tkR:0,
      vptH: tkH?ivaSuc(mH)/tkH:0, vptR: tkR?ivaSuc(mR)/tkR:0 };
  });
  const fmtU=n=>(n||0).toFixed(2);
  const titulo={fontSize:16,fontWeight:700,color:"#f1f5f9",marginBottom:14,paddingBottom:8,borderBottom:"2px solid #3b82f6"};

  return (<>
    <div style={{...c.card,marginBottom:12}}><div style={c.lbl}>Métricas por local — {fmtDate(fecha)} vs {fmtDate(fechaRef)}</div></div>

    <div style={{...c.card,marginBottom:12}}>
      <div style={titulo}>📦 Unidades por ticket</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{color:"#475569",fontSize:10,textTransform:"uppercase"}}>
          <td style={{padding:"7px 8px"}}>Local</td><td style={{padding:"7px 8px",textAlign:"right"}}>Hoy</td>
          <td style={{padding:"7px 8px",textAlign:"right"}}>Ref. ant.</td><td style={{padding:"7px 8px",textAlign:"right"}}>Var.</td>
        </tr></thead>
        <tbody>
          {filas.map(f=>{ const v=pct(f.uxtH,f.uxtR); return (
            <tr key={f.suc} style={{borderTop:"1px solid #0f172a"}}>
              <td style={{padding:"9px 8px"}}><span style={{display:"inline-flex",alignItems:"center",gap:7}}><span style={{width:8,height:8,borderRadius:"50%",background:SUC_COLORS[f.suc]}}/><span style={{fontWeight:500}}>{f.suc}</span></span></td>
              <td style={{padding:"9px 8px",textAlign:"right",fontWeight:600,fontSize:14}}>{fmtU(f.uxtH)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{fmtU(f.uxtR)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700}}>{sign(v)}</td>
            </tr>
          );})}
        </tbody>
      </table>
    </div>

    <div style={c.card}>
      <div style={titulo}>💵 Valor promedio por ticket (c/IVA)</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{color:"#475569",fontSize:10,textTransform:"uppercase"}}>
          <td style={{padding:"7px 8px"}}>Local</td><td style={{padding:"7px 8px",textAlign:"right"}}>Tickets hoy</td>
          <td style={{padding:"7px 8px",textAlign:"right"}}>$ prom. hoy</td><td style={{padding:"7px 8px",textAlign:"right"}}>$ prom. ant.</td>
          <td style={{padding:"7px 8px",textAlign:"right"}}>Var.</td>
        </tr></thead>
        <tbody>
          {filas.map(f=>{ const v=pct(f.vptH,f.vptR); return (
            <tr key={f.suc} style={{borderTop:"1px solid #0f172a"}}>
              <td style={{padding:"9px 8px"}}><span style={{display:"inline-flex",alignItems:"center",gap:7}}><span style={{width:8,height:8,borderRadius:"50%",background:SUC_COLORS[f.suc]}}/><span style={{fontWeight:500}}>{f.suc}</span></span></td>
              <td style={{padding:"9px 8px",textAlign:"right",color:"#94a3b8"}}>{fmt(f.tkH)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",fontWeight:600,fontSize:14}}>{fmtPesos(f.vptH)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{fmtPesos(f.vptR)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700}}>{sign(v)}</td>
            </tr>
          );})}
        </tbody>
      </table>
    </div>
  </>);
}

function AdminPanel({roles,setRoles,c}){
  const [sub,setSub]=useState("usuarios");
  const [users,setUsers]=useState(null);

  useEffect(()=>{ getUsers().then(r=>{ if(r.ok) setUsers(r.users); }); },[]);

  const subTab=(id,label)=>(
    <button onClick={()=>setSub(id)} style={{padding:"7px 16px",fontSize:13,borderRadius:7,cursor:"pointer",border:"1px solid #334155",
      background:sub===id?"#3b82f6":"transparent",color:sub===id?"#fff":"#94a3b8",fontWeight:sub===id?600:400}}>{label}</button>
  );

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {subTab("usuarios","👤 Usuarios")}
        {subTab("roles","🔑 Roles y permisos")}
      </div>
      {sub==="roles"    && <RolesPanel roles={roles} setRoles={setRoles} c={c}/>}
      {sub==="usuarios" && <UsuariosPanel roles={roles} users={users} setUsers={setUsers} c={c}/>}
    </div>
  );
}

function RolesPanel({roles,setRoles,c}){
  async function toggle(rol,campo,val){
    const r={...roles[rol]};
    if(campo==="vista"){ r.vistas = r.vistas.includes(val)?r.vistas.filter(x=>x!==val):[...r.vistas,val]; }
    else if(campo==="montos"){ r.verMontos=val; }
    const next={...roles,[rol]:r};
    setRoles(next);
    await saveRole(rol, r);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:13,color:"#64748b"}}>Definí qué ve cada rol. Los usuarios heredan estos permisos según su rol.</div>
      {Object.entries(roles).map(([rol,cfg])=>(
        <div key={rol} style={c.card}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <span style={{padding:"3px 10px",borderRadius:6,fontSize:13,fontWeight:600,background:rol==="admin"?"#3b82f6":"#334155",color:rol==="admin"?"#fff":"#cbd5e1"}}>{cfg.label}</span>
            {cfg.fijo&&<span style={{fontSize:11,color:"#475569"}}>(acceso total — no editable)</span>}
          </div>
          <div style={{marginBottom:12,opacity:cfg.fijo?0.5:1,pointerEvents:cfg.fijo?"none":"auto"}}>
            <div style={c.lbl}>Vistas permitidas</div>
            <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
              {["diario","montos","metricas"].map(v=>(
                <label key={v} style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer",color:"#cbd5e1"}}>
                  <input type="checkbox" checked={cfg.vistas.includes(v)} onChange={()=>toggle(rol,"vista",v)} disabled={cfg.fijo}/>
                  {VISTAS_INFO[v].icon} {VISTAS_INFO[v].label}
                </label>
              ))}
            </div>
          </div>
          <div style={{opacity:cfg.fijo?0.5:1,pointerEvents:cfg.fijo?"none":"auto"}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer",color:"#cbd5e1"}}>
              <input type="checkbox" checked={cfg.verMontos} onChange={e=>toggle(rol,"montos",e.target.checked)} disabled={cfg.fijo}/>
              Puede ver montos (importes, costos, utilidad)
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

function UsuariosPanel({roles,users,setUsers,c}){
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState(null);
  const [verP,setVerP]=useState(false);
  const [movil,setMovil]=useState(typeof window!=="undefined" && window.innerWidth<700);
  useEffect(()=>{ const f=()=>setMovil(window.innerWidth<700); window.addEventListener("resize",f); return ()=>window.removeEventListener("resize",f); },[]);
  if(!users) return <div style={{color:"#64748b",fontSize:13}}>Cargando usuarios…</div>;

  function startNew(){ setEditing("__new__"); setForm({user:"",pass:"",role:"encargado",sucursal:"24SET",label:""}); setVerP(false); }
  function startEdit(u){ setEditing(u); setForm({user:u,...users[u],pass:""}); setVerP(false); }
  function cancel(){ setEditing(null); setForm(null); }

  async function save(){
    const key=(form.user||"").trim().toLowerCase();
    if(!key){ alert("Falta el nombre de usuario"); return; }
    if(editing==="__new__"&&users[key]){ alert("Ya existe ese usuario"); return; }
    if(editing==="__new__"&&!form.pass){ alert("Falta la contraseña"); return; }
    const u={ pass:form.pass||undefined, role:form.role, sucursal:form.role==="admin"?null:form.sucursal, label:form.label||key };
    const r=await saveUser(key,u);
    if(!r.ok){ alert(r.error||"Error al guardar"); return; }
    const fresh=await getUsers(); if(fresh.ok) setUsers(fresh.users);
    cancel();
  }
  async function borrar(u){
    if(u==="admin"){ alert("No se puede borrar admin"); return; }
    if(confirm(`¿Borrar usuario ${u}?`)){ await removeUser(u); const fresh=await getUsers(); if(fresh.ok) setUsers(fresh.users); }
  }

  const inp={background:"#0f172a",border:"1px solid #334155",borderRadius:7,padding:"7px 10px",color:"#f1f5f9",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:13,color:"#64748b",flex:1,minWidth:160}}>Cada usuario hereda los permisos de su rol. Acá asignás credenciales, rol y sucursal.</div>
        {!editing&&<button onClick={startNew} style={{background:"#3b82f6",border:"none",borderRadius:7,padding:"7px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Nuevo usuario</button>}
      </div>

      {editing&&form&&(
        <div style={{...c.card,marginBottom:12}}>
          <div style={{...c.lbl,marginBottom:12}}>{editing==="__new__"?"Nuevo usuario":"Editar: "+editing}</div>
          <div style={{display:"grid",gridTemplateColumns:movil?"1fr":"1fr 1fr",gap:10,marginBottom:10}}>
            <div><div style={c.lbl}>Usuario</div><input style={inp} value={form.user} disabled={editing!=="__new__"} onChange={e=>setForm({...form,user:e.target.value})} placeholder="ej: enc_sal"/></div>
            <div><div style={c.lbl}>Contraseña {editing!=="__new__"&&<span style={{color:"#334155"}}>(vacío = no cambiar)</span>}</div>
              <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                <input type={verP?"text":"password"} style={{...inp,paddingRight:34}} value={form.pass} onChange={e=>setForm({...form,pass:e.target.value})} placeholder="contraseña"/>
                <button onClick={()=>setVerP(v=>!v)} type="button" style={{position:"absolute",right:6,background:"transparent",border:"none",cursor:"pointer",fontSize:15,padding:0,lineHeight:1}}>{verP?"🙈":"👁"}</button>
              </div>
            </div>
            <div><div style={c.lbl}>Nombre visible</div><input style={inp} value={form.label} onChange={e=>setForm({...form,label:e.target.value})} placeholder="ej: Encargado Salta"/></div>
            <div><div style={c.lbl}>Rol</div><select style={inp} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{Object.entries(roles).map(([r,cfg])=><option key={r} value={r}>{cfg.label}</option>)}</select></div>
          </div>
          {form.role==="encargado"&&(
            <div style={{marginBottom:14}}>
              <div style={c.lbl}>Sucursal asignada</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {SUCURSALES.map(s=>(
                  <button key={s} onClick={()=>setForm({...form,sucursal:s})} style={{padding:"5px 12px",fontSize:12,borderRadius:6,cursor:"pointer",border:"1px solid #334155",
                    background:form.sucursal===s?SUC_COLORS[s]:"#0f172a",color:form.sucursal===s?"#0f172a":"#94a3b8",fontWeight:form.sucursal===s?700:400}}>{s}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>Permisos del rol <b style={{color:"#94a3b8"}}>{roles[form.role]?.label}</b>: vistas {(roles[form.role]?.vistas||[]).map(v=>VISTAS_INFO[v]?.icon).join(" ")} · montos {roles[form.role]?.verMontos?"sí":"no"}</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={save} style={{background:"#22c55e",border:"none",borderRadius:7,padding:"8px 18px",color:"#0f172a",fontSize:13,fontWeight:700,cursor:"pointer"}}>Guardar</button>
            <button onClick={cancel} style={{background:"transparent",border:"1px solid #334155",borderRadius:7,padding:"8px 18px",color:"#94a3b8",fontSize:13,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}

      {movil ? (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {Object.entries(users).map(([k,u])=>{
            const cfg=roles[u.role]||{};
            return (
              <div key={k} style={{...c.card,padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:600}}>{k}</div>
                    <div style={{fontSize:11,color:"#64748b"}}>{u.label}</div>
                  </div>
                  <span style={{padding:"3px 10px",borderRadius:5,fontSize:11,background:u.role==="admin"?"#3b82f6":"#334155",color:u.role==="admin"?"#fff":"#94a3b8"}}>{cfg.label||u.role}</span>
                </div>
                <div style={{display:"flex",gap:16,fontSize:12,color:"#94a3b8",marginBottom:10,flexWrap:"wrap"}}>
                  <span>📍 <b style={{color:u.sucursal?SUC_COLORS[u.sucursal]:"#94a3b8"}}>{u.sucursal||"todas"}</b></span>
                  <span>Vistas: {(cfg.vistas||[]).map(v=>VISTAS_INFO[v]?.icon).join(" ")}</span>
                  <span>Montos: {cfg.verMontos?"✓":"✗"}</span>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>startEdit(k)} style={{flex:1,background:"transparent",border:"1px solid #334155",borderRadius:6,padding:"7px",color:"#60a5fa",fontSize:12,cursor:"pointer"}}>editar</button>
                  {k!=="admin"&&<button onClick={()=>borrar(k)} style={{flex:1,background:"transparent",border:"1px solid #7f1d1d",borderRadius:6,padding:"7px",color:"#f87171",fontSize:12,cursor:"pointer"}}>borrar</button>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={c.card}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{color:"#475569",fontSize:10,textTransform:"uppercase"}}>
              <td style={{padding:"8px"}}>Usuario</td><td style={{padding:"8px"}}>Rol</td><td style={{padding:"8px"}}>Sucursal</td>
              <td style={{padding:"8px"}}>Vistas (del rol)</td><td style={{padding:"8px"}}>Montos</td><td style={{padding:"8px",textAlign:"right"}}>Acciones</td>
            </tr></thead>
            <tbody>
              {Object.entries(users).map(([k,u])=>{
                const cfg=roles[u.role]||{};
                return (
                  <tr key={k} style={{borderTop:"1px solid #0f172a"}}>
                    <td style={{padding:"8px"}}><b>{k}</b><div style={{fontSize:10,color:"#475569"}}>{u.label}</div></td>
                    <td style={{padding:"8px"}}><span style={{padding:"2px 8px",borderRadius:5,fontSize:11,background:u.role==="admin"?"#3b82f6":"#334155",color:u.role==="admin"?"#fff":"#94a3b8"}}>{cfg.label||u.role}</span></td>
                    <td style={{padding:"8px",color:u.sucursal?SUC_COLORS[u.sucursal]:"#64748b"}}>{u.sucursal||"todas"}</td>
                    <td style={{padding:"8px",color:"#94a3b8"}}>{(cfg.vistas||[]).map(v=>VISTAS_INFO[v]?.icon).join(" ")}</td>
                    <td style={{padding:"8px"}}>{cfg.verMontos?<span style={{color:"#4ade80"}}>✓</span>:<span style={{color:"#475569"}}>✗</span>}</td>
                    <td style={{padding:"8px",textAlign:"right"}}>
                      <button onClick={()=>startEdit(k)} style={{background:"transparent",border:"1px solid #334155",borderRadius:6,padding:"4px 10px",color:"#60a5fa",fontSize:11,cursor:"pointer",marginRight:6}}>editar</button>
                      {k!=="admin"&&<button onClick={()=>borrar(k)} style={{background:"transparent",border:"1px solid #7f1d1d",borderRadius:6,padding:"4px 10px",color:"#f87171",fontSize:11,cursor:"pointer"}}>borrar</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
