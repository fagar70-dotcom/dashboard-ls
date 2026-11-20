import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { login as apiLogin, setToken, fetchVentas, getUsers, getRoles, saveUser, removeUser, saveRole, fetchVariaciones } from "./api";

const SUCURSALES = ["24SET","MENDO","MUÑE","SAL"];
const SUC_COLORS = { "24SET":"#4ade80","MENDO":"#60a5fa","MUÑE":"#facc15","SAL":"#f87171" };
const VISTAS_INFO = { diario:{icon:"📅",label:"Diario"}, montos:{icon:"💰",label:"Montos"}, metricas:{icon:"📈",label:"Métricas"}, clima:{icon:"⛅",label:"Clima"}, ranking:{icon:"🏆",label:"Ranking"}, vendedores:{icon:"🎯",label:"Vendedores"} };
const CIUDADES = {
  "Tucumán": { lat:-26.8241, lon:-65.2226, sucs:["24SET","MENDO","MUÑE"] },
  "Salta":   { lat:-24.7859, lon:-65.4117, sucs:["SAL"] },
};
const CIUDAD_LABEL = { "Tucumán":"SM de Tucumán", "Salta":"Salta Capital" };
function ciudadDeSucursal(suc){
  return Object.entries(CIUDADES).find(([,cfg])=>cfg.sucs.includes(suc))?.[0];
}
function wmoInfo(code){
  if(code===0) return {icon:"☀️",label:"Despejado"};
  if(code===1||code===2) return {icon:"🌤️",label:"Parcialmente nublado"};
  if(code===3) return {icon:"☁️",label:"Nublado"};
  if(code===45||code===48) return {icon:"🌫️",label:"Niebla"};
  if(code>=51&&code<=57) return {icon:"🌦️",label:"Llovizna"};
  if(code>=61&&code<=67) return {icon:"🌧️",label:"Lluvia"};
  if(code>=71&&code<=77) return {icon:"🌨️",label:"Nieve"};
  if(code>=80&&code<=82) return {icon:"🌧️",label:"Chubascos"};
  if(code>=95) return {icon:"⛈️",label:"Tormenta"};
  return {icon:"🌡️",label:"Sin datos"};
}
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

// Almacén de activaciones (para mensajes con duración) — persiste en el navegador
const META_STORE_KEY = "metaMsgStore";
function getMetaStore(){ try{ return JSON.parse(localStorage.getItem(META_STORE_KEY)||"{}"); }catch{ return {}; } }
function saveMetaStore(s){ try{ localStorage.setItem(META_STORE_KEY, JSON.stringify(s)); }catch{} }

// Mensaje motivacional según cumplimiento de meta y franja horaria (Argentina)
// meta = referencia del año anterior (mismo día de la semana). cumplido = unidades de hoy.
// Devuelve { texto, tipo } — tipo "goal" = titileo rojo/azul; "normal" = titileo amarillo.
function metaMensaje(cumplido, meta, ctxKey){
  if(!meta || meta<=0) return null;
  const faltante = Math.max(0,(1 - cumplido/meta) * 100); // % que falta para llegar a la meta
  const min = ahoraArg().min;
  const hoy = today();

  // Registro de activaciones por contexto (sucursal o TOTAL) y día
  let store = getMetaStore();
  if(store.fecha !== hoy) store = { fecha: hoy };
  const k = ctxKey || "TOTAL";
  const kBuen = k+"_buen", kPoco = k+"_poco", kUlt = k+"_ult";
  if(store[kBuen]==null && faltante<=60 && min>=510 && min<720)  store[kBuen]=min; // 08:30–12:00
  if(store[kPoco]==null && faltante<=20 && min>=1035 && min<1200) store[kPoco]=min; // 17:15–20:00
  if(store[kUlt] ==null && faltante<=10 && min>=1080 && min<1230) store[kUlt] =min; // 18:00–20:30
  saveMetaStore(store);

  // PRIORIDAD (de mayor a menor)
  // 1) Meta alcanzada o superada → titileo rojo/azul
  if(cumplido >= meta) return { texto:"ESPECTACULAR . Llegamos a la meta: Gran trabajo en equipo !!", tipo:"goal" };
  // 2) Último esfuerzo (≤10% activado entre 18:00 y 20:30) → permanente hasta la meta
  if(store[kUlt]!=null && faltante<=10) return { texto:"Un último esfuerzo ....falta poco", tipo:"normal" };
  // 3) Falta poco (≤20% entre 17:15 y 20:00) → 20 min desde la activación
  if(store[kPoco]!=null && faltante<=20 && min<=store[kPoco]+20) return { texto:"Falta poco. A no aflojar .....", tipo:"normal" };
  // 4) Muy buen desempeño (≤60% entre 08:30 y 12:00) → 30 min desde la activación
  if(store[kBuen]!=null && faltante<=60 && min<=store[kBuen]+30) return { texto:"Muy buen desempeño!! Grandes chances de alcanzar la meta diaria", tipo:"normal" };
  // 5) Vamos bien (≤60% hasta 17:15)
  if(min<=1035 && faltante<=60) return { texto:"Vamos bien. Es totalmente posible lograr la meta diaria !!!", tipo:"normal" };
  // 6) Así se hace (18:00–19:00, ≤70%)
  if(min>=1080 && min<=1140 && faltante<=70) return { texto:"Así se hace !!! vamos por el 100%", tipo:"normal" };
  // 7) Arranque del día (8:30–9:30)
  if(min>=510 && min<=570) return { texto:"Arrancamos el día con todo. Vamos que podemos !", tipo:"normal" };
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
// Trae el detalle de ventas CRUDO de todas las sucursales en una sola llamada (tal como
// recomienda la API: "una llamada por día"). Tanto Ranking como Vendedores arman sus
// distintas tablas (por sucursal, top 10, etc.) a partir de este mismo array en memoria,
// en vez de pedirle al servidor una consulta por cada tabla.
async function getDetalleVentasCrudo(fecha){
  const res = await fetchVentas({ action:"detalle_ventas", fecha_desde:fecha, fecha_fin:fecha, sucursales:"" });
  return res?.detalle_ventas?.filas || res?.filas || [];
}
function calcularRankingDesdeFilas(filasCrudas, sucursalFiltro){
  const filas = sucursalFiltro ? filasCrudas.filter(f=>(f.sucursal||"").toString().trim()===sucursalFiltro) : filasCrudas;
  const porVendedor = {};       // vendedor -> unidades totales
  const porVendedorSuc = {};    // vendedor -> { sucursal: unidades } (para saber a qué local pertenece)
  filas.forEach(f=>{
    const v = (f.vendedor||"").toString().trim();
    if(!v) return;
    const cant = Number(f.cantidad)||0;
    const suc = (f.sucursal||"").toString().trim();
    porVendedor[v] = (porVendedor[v]||0) + cant;
    if(suc){
      porVendedorSuc[v] = porVendedorSuc[v] || {};
      porVendedorSuc[v][suc] = (porVendedorSuc[v][suc]||0) + cant;
    }
  });
  const sucursalDe = (v)=>{
    const m = porVendedorSuc[v];
    if(!m) return "";
    return Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0]; // local donde más vendió ese día
  };
  return Object.entries(porVendedor)
    .map(([vendedor,unidades])=>({vendedor,unidades,sucursal:sucursalDe(vendedor)}))
    .sort((a,b)=>b.unidades-a.unidades);
}

// Puntos por línea de venta, según la fórmula del skill ranking-vendedores.
// Los extras (ACC/MARCAS/VALIJAS18) se suman aparte del GRAL; una línea puede sumar en varias categorías.
const MARCAS_BASE   = ["SAMSONITE","PRIMICIA","AMERICAN TOURISTER","XTREME"];
const MARCAS_VALIJA = ["REEBOK","LAS OREIRO"];
function puntosDeLinea(f){
  const cant = Number(f.cantidad)||0;
  const fam1 = (f.familia1||"").toString().trim().toUpperCase();
  const fam2 = (f.familia2||"").toString().trim().toUpperCase();
  const fam7 = (f.familia7||"").toString().trim().toUpperCase();
  const art  = (f.articulo||"").toString().trim().toUpperCase();
  const esAcc      = fam2.includes("BILLETERA MUJER") || fam1.includes("ACCESORIO VIAJE");
  const esMarca    = MARCAS_BASE.includes(fam7) || (MARCAS_VALIJA.includes(fam7) && fam1==="VALIJA");
  const esValijas18= fam1.includes("VALIJA") && art.includes("18");
  const gral = cant*1;
  const acc  = esAcc ? cant*2 : 0;
  const marcas = esMarca ? cant*3 : 0;
  const valijas18 = esValijas18 ? cant*3 : 0;
  return { gral, acc, marcas, valijas18, total: gral+acc+marcas+valijas18, esAcc, esMarca, esValijas18 };
}
// Agrupa líneas crudas {articulo,cantidad} por artículo, sumando cantidad, para el detalle on-hover.
function agregarPorArticulo(lineas){
  const m = {};
  lineas.forEach(l=>{ const k = l.articulo || "(sin descripción)"; m[k] = (m[k]||0) + l.cantidad; });
  return Object.entries(m)
    .map(([articulo,cantidad])=>({articulo,cantidad}))
    .sort((a,b)=>b.cantidad-a.cantidad);
}
function calcularPuntosDesdeFilas(filasCrudas, sucursalFiltro){
  const filas = sucursalFiltro ? filasCrudas.filter(f=>(f.sucursal||"").toString().trim()===sucursalFiltro) : filasCrudas;
  const porVendedor = {};
  const porVendedorSuc = {};    // vendedor -> { sucursal: unidades } (para saber a qué local pertenece)
  const porVendedorLineas = {}; // vendedor -> { gral:[], acc:[], marcas:[], valijas18:[] } líneas crudas
  filas.forEach(f=>{
    const v = (f.vendedor||"").toString().trim();
    if(!v) return;
    const p = puntosDeLinea(f);
    if(!porVendedor[v]) porVendedor[v] = {gral:0,acc:0,marcas:0,valijas18:0,total:0};
    porVendedor[v].gral      += p.gral;
    porVendedor[v].acc       += p.acc;
    porVendedor[v].marcas    += p.marcas;
    porVendedor[v].valijas18 += p.valijas18;
    porVendedor[v].total     += p.total;

    const art = (f.articulo||"").toString().trim();
    const cant = Number(f.cantidad)||0;
    if(!porVendedorLineas[v]) porVendedorLineas[v] = {gral:[],acc:[],marcas:[],valijas18:[]};
    porVendedorLineas[v].gral.push({articulo:art,cantidad:cant});
    if(p.esAcc)       porVendedorLineas[v].acc.push({articulo:art,cantidad:cant});
    if(p.esMarca)     porVendedorLineas[v].marcas.push({articulo:art,cantidad:cant});
    if(p.esValijas18) porVendedorLineas[v].valijas18.push({articulo:art,cantidad:cant});

    const suc = (f.sucursal||"").toString().trim();
    if(suc){
      porVendedorSuc[v] = porVendedorSuc[v] || {};
      porVendedorSuc[v][suc] = (porVendedorSuc[v][suc]||0) + cant;
    }
  });
  const sucursalDe = (v)=>{
    const m = porVendedorSuc[v];
    if(!m) return "";
    return Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0]; // local donde más vendió ese día
  };
  return Object.entries(porVendedor)
    .map(([vendedor,p])=>{
      const l = porVendedorLineas[vendedor] || {gral:[],acc:[],marcas:[],valijas18:[]};
      return {
        vendedor, ...p, sucursal:sucursalDe(vendedor),
        detalle: {
          gral: agregarPorArticulo(l.gral),
          acc: agregarPorArticulo(l.acc),
          marcas: agregarPorArticulo(l.marcas),
          valijas18: agregarPorArticulo(l.valijas18),
        },
      };
    })
    .sort((a,b)=>b.total-a.total);
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
        const [hoyArr, refArr] = await Promise.all([
          Promise.all(sucs.map(s=>getMontosSuc(fecha,s))),
          Promise.all(sucs.map(s=>getMontosSuc(fechaRef,s))),
        ]);
        sucs.forEach((s,i)=>{ montosHoy[s]=hoyArr[i]; montosRef[s]=refArr[i]; });
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
  ["diario","montos","metricas","clima","ranking","vendedores"].forEach(v=>{ if(misVistas.includes(v)) tabs.push(v); });
  if(isAdmin) tabs.push("usuarios");

  return (
    <div style={c.page}>
      <style>{`@keyframes metaBlink{0%,100%{border-color:#facc15;box-shadow:0 0 18px 3px rgba(250,204,21,.75)}50%{border-color:#4a3f0c;box-shadow:0 0 0 0 rgba(250,204,21,0)}}@keyframes metaGoal{0%,100%{border-color:#ef4444;box-shadow:0 0 26px 6px rgba(239,68,68,.85);color:#fca5a5}50%{border-color:#3b82f6;box-shadow:0 0 26px 6px rgba(59,130,246,.85);color:#93c5fd}}`}</style>
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
          {data&&!loading&&vista==="clima"     && misVistas.includes("clima")    && <Clima data={data} c={c}/>}
          {data&&!loading&&vista==="ranking"   && misVistas.includes("ranking")  && <Ranking fecha={fecha} auth={auth} c={c}/>}
          {data&&!loading&&vista==="vendedores"&& misVistas.includes("vendedores")&& <Vendedores fecha={fecha} auth={auth} c={c}/>}
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

function Confetti(){
  const ref = useRef(null);
  useEffect(()=>{
    const canvas = ref.current; if(!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    const colors = ["#f87171","#facc15","#4ade80","#60a5fa","#c084fc","#fb923c","#f472b6","#22d3ee"];
    const N = 150;
    const spawn = (top)=>({
      x: Math.random()*W,
      y: top ? Math.random()*-H : Math.random()*H,
      w: 6+Math.random()*8, h: 9+Math.random()*11,
      color: colors[(Math.random()*colors.length)|0],
      rot: Math.random()*Math.PI*2, vr: -0.12+Math.random()*0.24,
      vy: 1.4+Math.random()*3, vx: -1+Math.random()*2, sway: Math.random()*Math.PI*2,
    });
    const pieces = Array.from({length:N}, ()=>spawn(false));
    const onResize = ()=>{ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; };
    window.addEventListener("resize", onResize);
    let raf;
    const frame = ()=>{
      ctx.clearRect(0,0,W,H);
      for(const p of pieces){
        p.y += p.vy; p.sway += 0.03; p.x += p.vx + Math.sin(p.sway)*0.8; p.rot += p.vr;
        if(p.y > H+20){ Object.assign(p, spawn(true)); }
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.globalAlpha = 0.9;
        ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  },[]);
  return <canvas ref={ref} style={{position:"fixed",inset:0,width:"100vw",height:"100vh",pointerEvents:"none",zIndex:40}}/>;
}

function ClimaResumen({ciudad,fecha,c}){
  const cfg = CIUDADES[ciudad];
  const [cl,setCl] = useState(null);
  const [est,setEst] = useState("cargando");
  useEffect(()=>{
    let activo=true;
    setEst("cargando"); setCl(null);
    if(!cfg){ setEst("error"); return; }
    fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${cfg.lat}&longitude=${cfg.lon}&start_date=${fecha}&end_date=${fecha}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`)
      .then(r=>r.json()).then(j=>{
        if(!activo) return;
        const d=j?.daily;
        if(d && d.temperature_2m_max){
          setCl({tmax:d.temperature_2m_max[0],tmin:d.temperature_2m_min[0],precip:d.precipitation_sum[0],code:d.weathercode[0]});
          setEst("ok");
        } else setEst("error");
      }).catch(()=>{ if(activo) setEst("error"); });
    return ()=>{ activo=false; };
  },[ciudad,fecha]);

  const nombreCiudad = CIUDAD_LABEL[ciudad] || ciudad;
  const tituloClima = (<><div>Clima {fmtDate(fecha)}</div><div>{nombreCiudad}</div></>);
  if(est==="cargando") return <div style={c.card}><div style={{...c.lbl,color:"#94a3b8"}}>{tituloClima}</div><div style={{fontSize:12,color:"#64748b",marginTop:8}}>Cargando…</div></div>;
  if(est==="error"||!cl) return <div style={c.card}><div style={{...c.lbl,color:"#94a3b8"}}>{tituloClima}</div><div style={{fontSize:12,color:"#64748b",marginTop:8}}>Sin datos</div></div>;
  const info = wmoInfo(cl.code);
  return (
    <div style={c.card}>
      <div style={{...c.lbl,color:"#94a3b8",marginBottom:4}}>{tituloClima}</div>
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <span style={{fontSize:30,lineHeight:1}}>{info.icon}</span>
        <span style={{fontSize:30,fontWeight:700,color:"#f1f5f9",lineHeight:1.1}}>{Math.round(cl.tmax)}° / {Math.round(cl.tmin)}°</span>
      </div>
      <div style={c.sub}>{info.label}{cl.precip>0?` · ${cl.precip.toFixed(1)}mm`:""}</div>
    </div>
  );
}

// Tabla genérica de ranking de vendedores por unidades. Si incluirLocal=true muestra
// columna "Local" (para el ranking global, que mezcla vendedores de distintas sucursales).
function RankingTabla({titulo,filas,incluirLocal,c}){
  return (
    <div style={c.card}>
      <div style={{...c.lbl,marginBottom:10,paddingBottom:8,borderBottom:"1px solid #334155",color:"#ffffff",fontSize:15,fontWeight:800,textTransform:"none",letterSpacing:"normal"}}>{titulo}</div>
      {filas.length===0 && <div style={{fontSize:12,color:"#64748b",padding:"6px 0"}}>Sin datos para hoy.</div>}
      {filas.length>0 && (
        <div style={{maxHeight:420,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{color:"#94a3b8",fontSize:11,fontWeight:700,textTransform:"uppercase"}}>
              <td style={{padding:"7px 8px"}}>#</td>
              <td style={{padding:"7px 8px"}}>Vendedor</td>
              {incluirLocal && <td style={{padding:"7px 8px"}}>Local</td>}
              <td style={{padding:"7px 8px",textAlign:"right"}}>Unidades</td>
            </tr></thead>
            <tbody>
              {filas.map((v,i)=>(
                <tr key={v.vendedor} style={{borderTop:"1px solid #0f172a"}}>
                  <td style={{padding:"9px 8px",color:"#64748b"}}>{i+1}</td>
                  <td style={{padding:"9px 8px",fontWeight:i===0?700:500,color:"#f1f5f9"}}>{v.vendedor}</td>
                  {incluirLocal && <td style={{padding:"9px 8px"}}>{v.sucursal ? <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:SUC_COLORS[v.sucursal]||"#64748b"}}/><span style={{color:"#94a3b8"}}>{v.sucursal}</span></span> : <span style={{color:"#475569"}}>—</span>}</td>}
                  <td style={{padding:"9px 8px",textAlign:"right",fontWeight:700,fontSize:16,color:"#4ade80"}}>{fmt(v.unidades)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Ranking({fecha,auth,c}){
  const esEncargado = auth.role === "encargado";
  const miSuc = auth.sucursal;
  const [filasCrudas,setFilasCrudas] = useState(null);
  const [est,setEst] = useState("cargando");
  useEffect(()=>{
    let activo=true;
    setEst("cargando"); setFilasCrudas(null);
    getDetalleVentasCrudo(fecha).then(r=>{ if(activo){ setFilasCrudas(r); setEst("ok"); } })
      .catch(()=>{ if(activo) setEst("error"); });
    return ()=>{ activo=false; };
  },[fecha]);

  if(est==="cargando") return <div style={{textAlign:"center",padding:"3rem",color:"#475569",fontSize:13}}>Cargando…</div>;
  if(est==="error") return <div style={{fontSize:12,color:"#fca5a5",padding:"1rem"}}>No se pudo obtener el detalle de ventas.</div>;

  const sucursalesAMostrar = esEncargado ? [miSuc] : SUCURSALES;
  const top10 = calcularRankingDesdeFilas(filasCrudas,"").slice(0,10);

  return (
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
      <div style={{flex:"1 1 320px",minWidth:280,display:"flex",flexDirection:"column",gap:12}}>
        {sucursalesAMostrar.map(s=>(
          <RankingTabla key={s} titulo={`Ranking vendedores — ${s}`} filas={calcularRankingDesdeFilas(filasCrudas,s)} incluirLocal={false} c={c}/>
        ))}
      </div>
      <div style={{flex:"1 1 320px",minWidth:280}}>
        <RankingTabla titulo="Top 10 vendedores — todas las sucursales" filas={top10} incluirLocal={true} c={c}/>
      </div>
    </div>
  );
}

// Tabla de puntos por vendedor (fórmula del skill ranking-vendedores), para una sucursal.
// Tooltip flotante (position:fixed) con el detalle de artículos de la categoría señalada.
function TipDetalle({tip,onEnter,onLeave}){
  const ref = useRef(null);
  const [pos,setPos] = useState(null);
  useLayoutEffect(()=>{
    if(!tip || !ref.current){ setPos(null); return; }
    const el = ref.current;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = tip.x;
    if(left + w > vw-8) left = vw-w-8;
    if(left < 8) left = 8;
    let top = tip.y;
    if(top + h > vh-8){
      top = tip.anchorTop - h - 4; // no entra abajo: lo mostramos arriba del valor
      if(top < 8) top = 8;
    }
    setPos({left,top});
  },[tip]);

  if(!tip) return null;
  const left = pos ? pos.left : tip.x;
  const top  = pos ? pos.top  : tip.y;
  // pointerEvents activos + onMouseEnter/Leave propios: así se puede mover el mouse
  // desde el valor hasta la lista y scrollearla, sin que se cierre en el camino.
  return (
    <div ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave} style={{position:"fixed",left,top,zIndex:1000,
      background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"8px 10px",
      minWidth:200,maxWidth:300,maxHeight:"70vh",overflowY:"auto",boxShadow:"0 6px 20px rgba(0,0,0,.5)"}}>
      <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",marginBottom:6,letterSpacing:"0.05em"}}>{tip.titulo}</div>
      {tip.items.map((it,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",gap:14,fontSize:12,padding:"3px 0",borderTop:i>0?"1px solid #1e293b":"none"}}>
          <span style={{color:"#cbd5e1"}}>{it.label}</span>
          <span style={{color:"#94a3b8",whiteSpace:"nowrap",marginLeft:8}}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function PuntosTabla({titulo,filas,incluirLocal,c}){
  const [tip,setTip] = useState(null);
  const hideTimer = useRef(null);
  useEffect(()=>()=>{ if(hideTimer.current) clearTimeout(hideTimer.current); },[]);
  // Permite cerrar el desplegable con la tecla Escape.
  useEffect(()=>{
    if(!tip) return;
    const onKey = e=>{ if(e.key==="Escape") setTip(null); };
    window.addEventListener("keydown", onKey);
    return ()=>window.removeEventListener("keydown", onKey);
  },[tip]);

  function cancelarOcultar(){ if(hideTimer.current){ clearTimeout(hideTimer.current); hideTimer.current=null; } }
  // Espera un instante antes de ocultar, para dar tiempo a mover el mouse desde el
  // valor hasta la lista desplegable (y poder scrollearla) sin que se cierre en el camino.
  function ocultar(){ cancelarOcultar(); hideTimer.current = setTimeout(()=>setTip(null), 200); }

  function mostrarDetalle(e, titulo, detalle){
    cancelarOcultar();
    if(!detalle || !detalle.length){ setTip(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(rect.left, (typeof window!=="undefined"?window.innerWidth:1000)-310);
    setTip({ x, y: rect.bottom+4, anchorTop: rect.top, titulo, items: detalle.map(d=>({label:d.articulo,value:`${fmt(d.cantidad)} u`})) });
  }
  function mostrarResumen(e, v){
    cancelarOcultar();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(rect.left, (typeof window!=="undefined"?window.innerWidth:1000)-310);
    setTip({ x, y: rect.bottom+4, anchorTop: rect.top, titulo:"Total puntos — composición", items:[
      {label:"Gral", value:`${fmt(v.gral)} pts`},
      {label:"Acc", value:`${fmt(v.acc)} pts`},
      {label:"Marcas", value:`${fmt(v.marcas)} pts`},
      {label:'Valijas 18"', value:`${fmt(v.valijas18)} pts`},
      {label:"Total", value:`${fmt(v.total)} pts`},
    ]});
  }
  const celda = (valor,color,fontWeight,fontSize)=>({padding:"9px 8px",textAlign:"right",color,fontWeight,fontSize,cursor:"help"});

  return (
    <div style={c.card}>
      <div style={{...c.lbl,marginBottom:10,paddingBottom:8,borderBottom:"1px solid #334155",color:"#ffffff",fontSize:15,fontWeight:800,textTransform:"none",letterSpacing:"normal"}}>{titulo}</div>
      {filas.length===0 && <div style={{fontSize:12,color:"#64748b",padding:"6px 0"}}>Sin datos para hoy.</div>}
      {filas.length>0 && (
        <div style={{maxHeight:420,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{color:"#94a3b8",fontSize:11,fontWeight:700,textTransform:"uppercase"}}>
              <td style={{padding:"7px 8px"}}>#</td>
              <td style={{padding:"7px 8px"}}>Vendedor</td>
              {incluirLocal && <td style={{padding:"7px 8px"}}>Local</td>}
              <td style={{padding:"7px 8px",textAlign:"right"}}>Gral</td>
              <td style={{padding:"7px 8px",textAlign:"right"}}>Acc</td>
              <td style={{padding:"7px 8px",textAlign:"right"}}>Marcas</td>
              <td style={{padding:"7px 8px",textAlign:"right"}}>Val. 18"</td>
              <td style={{padding:"7px 8px",textAlign:"right"}}>Total</td>
            </tr></thead>
            <tbody onMouseLeave={ocultar}>
              {filas.map((v,i)=>(
                <tr key={v.vendedor} style={{borderTop:"1px solid #0f172a"}}>
                  <td style={{padding:"9px 8px",color:"#64748b"}}>{i+1}</td>
                  <td style={{padding:"9px 8px",fontWeight:i===0?700:500,color:"#f1f5f9"}}>{v.vendedor}</td>
                  {incluirLocal && <td style={{padding:"9px 8px"}}>{v.sucursal ? <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:SUC_COLORS[v.sucursal]||"#64748b"}}/><span style={{color:"#94a3b8"}}>{v.sucursal}</span></span> : <span style={{color:"#475569"}}>—</span>}</td>}
                  <td style={celda(null,"#94a3b8")} onMouseEnter={e=>mostrarDetalle(e,`${v.vendedor} — GRAL (unidades)`,v.detalle?.gral)} onMouseLeave={ocultar}>{fmt(v.gral)}</td>
                  <td style={celda(null,"#94a3b8")} onMouseEnter={e=>mostrarDetalle(e,`${v.vendedor} — ACC VIAJE Y BILLETERAS MUJER`,v.detalle?.acc)} onMouseLeave={ocultar}>{fmt(v.acc)}</td>
                  <td style={celda(null,"#94a3b8")} onMouseEnter={e=>mostrarDetalle(e,`${v.vendedor} — MARCAS`,v.detalle?.marcas)} onMouseLeave={ocultar}>{fmt(v.marcas)}</td>
                  <td style={celda(null,"#94a3b8")} onMouseEnter={e=>mostrarDetalle(e,`${v.vendedor} — VALIJAS 18"`,v.detalle?.valijas18)} onMouseLeave={ocultar}>{fmt(v.valijas18)}</td>
                  <td style={celda(null,"#facc15",700,16)} onMouseEnter={e=>mostrarResumen(e,v)} onMouseLeave={ocultar}>{fmt(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TipDetalle tip={tip} onEnter={cancelarOcultar} onLeave={ocultar}/>
    </div>
  );
}
function Vendedores({fecha,auth,c}){
  const esEncargado = auth.role === "encargado";
  const miSuc = auth.sucursal;
  const [filasCrudas,setFilasCrudas] = useState(null);
  const [est,setEst] = useState("cargando");
  useEffect(()=>{
    let activo=true;
    setEst("cargando"); setFilasCrudas(null);
    getDetalleVentasCrudo(fecha).then(r=>{ if(activo){ setFilasCrudas(r); setEst("ok"); } })
      .catch(()=>{ if(activo) setEst("error"); });
    return ()=>{ activo=false; };
  },[fecha]);

  const encabezadoFecha = (
    <div style={{...c.card,marginBottom:12,background:"#1e2536",borderColor:"#475569",display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
      <div style={{...c.lbl,color:"#94a3b8"}}>Puntos del día</div>
      <div style={{fontSize:24,fontWeight:800,color:"#f1f5f9"}}>{cap(dayName(fecha))} {fmtDate(fecha)}</div>
    </div>
  );

  if(est==="cargando") return (<>{encabezadoFecha}<div style={{textAlign:"center",padding:"3rem",color:"#475569",fontSize:13}}>Cargando…</div></>);
  if(est==="error") return (<>{encabezadoFecha}<div style={{fontSize:12,color:"#fca5a5",padding:"1rem"}}>No se pudo obtener el detalle de ventas.</div></>);

  const sucursalesAMostrar = esEncargado ? [miSuc] : SUCURSALES;
  const top10 = calcularPuntosDesdeFilas(filasCrudas,"").slice(0,10);

  return (<>
    {encabezadoFecha}
    {esEncargado ? (
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
        <div style={{flex:"1 1 320px",minWidth:280}}>
          <PuntosTabla titulo={`Puntos vendedores — ${miSuc}`} filas={calcularPuntosDesdeFilas(filasCrudas,miSuc)} incluirLocal={false} c={c}/>
        </div>
        <div style={{flex:"1 1 320px",minWidth:280}}>
          <PuntosTabla titulo="Top 10 vendedores — puntos (todas las sucursales)" filas={top10} incluirLocal={true} c={c}/>
        </div>
      </div>
    ) : (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(360px,1fr))",gap:12}}>
        {sucursalesAMostrar.map(s=>(
          <PuntosTabla key={s} titulo={`Puntos vendedores — ${s}`} filas={calcularPuntosDesdeFilas(filasCrudas,s)} incluirLocal={false} c={c}/>
        ))}
      </div>
    )}
  </>);
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
  const ctxKey = esEncargado ? miSuc : "TOTAL";
  const msgMeta = metaMensaje(totalHoy, totalRef, ctxKey);

  return (<>
    {msgMeta?.tipo==="goal" && <Confetti/>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:12}}>
      <div style={{...c.card,background:"#16261c",borderColor:"#22c55e"}}><div style={{...c.lbl,color:"#4ade80"}}>{esEncargado?"Unidades hoy":"Total hoy"}</div><div style={{...c.big,color:"#4ade80"}}>{fmt(totalHoy)}</div><div style={c.sub}>{cap(dayName(fecha))} · {esEncargado?miSuc:"unidades"}</div></div>
      <div style={{...c.card,background:"#1e2536",borderColor:"#475569"}}><div style={{...c.lbl,color:"#94a3b8"}}>Ref. ant.</div><div style={{...c.big,color:"#94a3b8"}}>{fmt(totalRef)}</div><div style={c.sub}>{fmtDate(fechaRef)}</div></div>
      <div style={c.card}><div style={c.lbl}>Variación</div><div style={{...c.big,color:signColor(varTotal)}}>{sign(varTotal)}</div><div style={c.sub}>{(totalHoy-totalRef>=0?"+":"")+fmt(totalHoy-totalRef)} u</div></div>
      {!esEncargado && <div style={c.card}><div style={c.lbl}>Mejor local</div><div style={{...c.big,fontSize:22,color:SUC_COLORS[mejor]}}>{mejor}</div><div style={c.sub}>{fmt(hoy[mejor])} u</div></div>}
      {esEncargado && <ClimaResumen ciudad={ciudadDeSucursal(miSuc)} fecha={fechaRef} c={c}/>}
      {msgMeta && (
        msgMeta.tipo==="goal" ? (
          <div style={{...c.card,gridColumn:"1 / -1",border:"3px solid #ef4444",animation:"metaGoal 0.8s ease-in-out infinite",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",textAlign:"center",padding:"18px"}}>
            <div style={{fontSize:11,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6,color:"inherit",opacity:.9}}>🎉 Meta alcanzada</div>
            <div style={{fontSize:19,fontWeight:800,color:"inherit",lineHeight:1.25}}>{msgMeta.texto}</div>
          </div>
        ) : (
          <div style={{...c.card,border:"2px solid #facc15",animation:"metaBlink 1s ease-in-out infinite",display:"flex",flexDirection:"column",justifyContent:"center",minWidth:160}}>
            <div style={{...c.lbl,color:"#facc15"}}>Meta del día</div>
            <div style={{fontSize:15,fontWeight:700,color:"#fde047",lineHeight:1.3}}>{msgMeta.texto}</div>
          </div>
        )
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
                <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700,fontSize:19}}>{sign(v)}</td>
              </tr>
            );
          })}
          {!esEncargado&&(
            <tr style={{borderTop:"1px solid #334155"}}>
              <td style={{padding:"9px 8px",color:"#94a3b8",fontWeight:600}}>TOTAL</td>
              <td style={{padding:"9px 8px",textAlign:"right",fontWeight:700,color:"#facc15",fontSize:14}}>{fmt(totalGeneral)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{fmt(totalGenRef)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(pct(totalGeneral,totalGenRef))}}>{totalGeneral-totalGenRef>=0?"+":""}{fmt(totalGeneral-totalGenRef)}</td>
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(pct(totalGeneral,totalGenRef)),fontWeight:700,fontSize:19}}>{sign(pct(totalGeneral,totalGenRef))}</td>
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
                <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700,fontSize:19}}>{sign(v)}</td>
              </tr>
            );
          })}
          <tr style={{borderTop:"1px solid #334155"}}>
            <td style={{padding:"9px 8px",color:"#94a3b8",fontWeight:600}}>TOTAL</td>
            <td style={{padding:"9px 8px",textAlign:"right",fontWeight:700,color:"#facc15",fontSize:14}}>{fmtM(totalHoy)}</td>
            <td style={{padding:"9px 8px",textAlign:"right",color:"#64748b"}}>{fmtM(totalRef)}</td>
            <td style={{padding:"9px 8px",textAlign:"right",color:signColor(varTotal)}}>{totalHoy-totalRef>=0?"+":""}{fmtM(totalHoy-totalRef)}</td>
            <td style={{padding:"9px 8px",textAlign:"right",color:signColor(varTotal),fontWeight:700,fontSize:19}}>{sign(varTotal)}</td>
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
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:12}}>
      <div style={{...c.card,background:"#16261c",borderColor:"#22c55e"}}><div style={{...c.lbl,color:"#4ade80"}}>Hoy</div><div style={{...c.big,fontSize:20,color:"#4ade80"}}>{cap(dayName(fecha))}</div><div style={c.sub}>{fmtDate(fecha)}</div></div>
      <div style={{...c.card,background:"#1e2536",borderColor:"#475569"}}><div style={{...c.lbl,color:"#94a3b8"}}>Ref. ant.</div><div style={{...c.big,fontSize:20,color:"#94a3b8"}}>{cap(dayName(fechaRef))}</div><div style={c.sub}>{fmtDate(fechaRef)}</div></div>
    </div>

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
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700,fontSize:19}}>{sign(v)}</td>
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
              <td style={{padding:"9px 8px",textAlign:"right",color:signColor(v),fontWeight:700,fontSize:19}}>{sign(v)}</td>
            </tr>
          );})}
        </tbody>
      </table>
    </div>
  </>);
}

function Clima({data,c}){
  const fechaRef = data.fechaRef;
  return (<>
    <div style={{...c.card,marginBottom:12,background:"#1e2536",borderColor:"#475569",display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
      <div style={{...c.lbl,color:"#94a3b8"}}>Día de referencia (año anterior)</div>
      <div style={{fontSize:24,fontWeight:800,color:"#f1f5f9"}}>{cap(dayName(fechaRef))} {fmtDate(fechaRef)}</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
      {Object.keys(CIUDADES).map(nombre=>(
        <ClimaResumen key={nombre} ciudad={nombre} fecha={fechaRef} c={c}/>
      ))}
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
              {["diario","montos","metricas","clima","ranking","vendedores"].map(v=>(
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
