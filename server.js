import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

const API_BASE = "https://lasorpresa.osweb.com.ar/api/index.php";
const API_KEY  = process.env.GESTION_API_KEY;
const USERS_FILE = path.join(__dirname, "users.json");

const SUCURSALES = ["24SET", "MENDO", "MUÑE", "SAL"];
const VISTAS_VALIDAS = ["diario", "periodo", "montos"];

// ── Usuarios: cargar / guardar en JSON ──
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    // Usuarios por defecto la primera vez
    const def = {
      admin: { pass: "admin123", role: "admin", sucursal: null, vistas: ["diario","periodo","montos"], verMontos: true, label: "Administrador" },
    };
    saveUsers(def);
    return def;
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}
let USERS = loadUsers();

// ── Sesiones en memoria ──
const sessions = {};
const makeToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── Login ──
app.post("/api/login", (req, res) => {
  const { user, pass } = req.body || {};
  const u = USERS[user];
  if (!u || u.pass !== pass) return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
  const token = makeToken();
  sessions[token] = { user, ...u };
  res.json({
    ok: true, token,
    role: u.role, sucursal: u.sucursal, label: u.label || user,
    vistas: u.vistas || ["diario"], verMontos: !!u.verMontos,
  });
});

// ── Middleware auth ──
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const s = sessions[token];
  if (!s) return res.status(401).json({ ok: false, error: "No autorizado" });
  req.session = s;
  next();
}
function adminOnly(req, res, next) {
  if (req.session.role !== "admin") return res.status(403).json({ ok: false, error: "Solo admin" });
  next();
}

// ── Gestión de usuarios (solo admin) ──
app.get("/api/users", auth, adminOnly, (req, res) => {
  // No devolver contraseñas
  const safe = {};
  for (const [k, v] of Object.entries(USERS)) {
    safe[k] = { role: v.role, sucursal: v.sucursal, vistas: v.vistas, verMontos: v.verMontos, label: v.label };
  }
  res.json({ ok: true, users: safe });
});

app.post("/api/users", auth, adminOnly, (req, res) => {
  const { user, pass, role, sucursal, vistas, verMontos, label } = req.body || {};
  if (!user || !pass) return res.status(400).json({ ok: false, error: "Usuario y contraseña requeridos" });
  if (role === "encargado" && !SUCURSALES.includes(sucursal))
    return res.status(400).json({ ok: false, error: "Encargado necesita sucursal válida" });
  USERS[user] = {
    pass,
    role: role === "admin" ? "admin" : "encargado",
    sucursal: role === "admin" ? null : sucursal,
    vistas: (vistas || ["diario"]).filter(v => VISTAS_VALIDAS.includes(v)),
    verMontos: !!verMontos,
    label: label || user,
  };
  saveUsers(USERS);
  res.json({ ok: true });
});

app.put("/api/users/:user", auth, adminOnly, (req, res) => {
  const u = USERS[req.params.user];
  if (!u) return res.status(404).json({ ok: false, error: "No existe" });
  const { pass, role, sucursal, vistas, verMontos, label } = req.body || {};
  if (pass) u.pass = pass;
  if (role) { u.role = role === "admin" ? "admin" : "encargado"; u.sucursal = role === "admin" ? null : sucursal; }
  if (sucursal !== undefined && u.role === "encargado") u.sucursal = sucursal;
  if (vistas) u.vistas = vistas.filter(v => VISTAS_VALIDAS.includes(v));
  if (verMontos !== undefined) u.verMontos = !!verMontos;
  if (label) u.label = label;
  saveUsers(USERS);
  res.json({ ok: true });
});

app.delete("/api/users/:user", auth, adminOnly, (req, res) => {
  if (req.params.user === "admin") return res.status(400).json({ ok: false, error: "No se puede borrar admin" });
  delete USERS[req.params.user];
  saveUsers(USERS);
  res.json({ ok: true });
});

// ── Llamada a la API de osweb ──
async function callOsweb(endpoint, body) {
  const r = await fetch(`${API_BASE}?endpoint=${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, error: "Respuesta no-JSON", raw: text }; }
}

// ── Proxy ventas ──
app.post("/api/ventas", auth, async (req, res) => {
  try {
    let { action, fecha_desde, fecha_fin, sucursales } = req.body;
    // Encargado: forzar su sucursal y bloquear montos si su rol no lo permite
    if (req.session.role === "encargado") {
      sucursales = req.session.sucursal;
      const rol = ROLES[req.session.role] || {};
      if (action === "montos_por_tipo" && !rol.verMontos)
        return res.status(403).json({ ok: false, error: "Sin permiso para montos" });
    }
    const data = await callOsweb("ventas_ls", {
      action,
      buscar_inicio: fecha_desde,
      buscar_fin: fecha_fin,
      listasuc: sucursales || "",
      solo_impstock: 0,
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Variaciones por local (solo %, sin valores) — para encargados ──
// Devuelve la variación % de unidades de cada local (hoy vs fecha_ref),
// SIN exponer los valores absolutos de los locales ajenos.
function parseTotalPorSuc(text) {
  // tabla "| Sucursal | Tipo1 | Tipo2 | Total |"
  const out = {};
  const lines = (text || "").split("\n").map(l => l.trim()).filter(l => l.includes("|"));
  for (const line of lines) {
    if (/^\|?[\s:|-]+\|?$/.test(line)) continue;
    const cells = line.split("|").map(c => c.replace(/\*/g, "").trim()).filter(Boolean);
    const suc = cells[0];
    if (["24SET","MENDO","MUÑE","SAL"].includes(suc)) {
      out[suc] = parseFloat((cells[3]||"0").replace(/\./g,"").replace(",",".")) || 0;
    }
  }
  return out;
}

app.post("/api/variaciones", auth, async (req, res) => {
  try {
    const { fecha_desde, fecha_fin } = req.body;
    // Consulta los 4 locales (el backend tiene la key, no hay restricción)
    const [hoyData, refData] = await Promise.all([
      callOsweb("ventas_ls", { action:"unidades_sucursal_tipo", buscar_inicio:fecha_desde, buscar_fin:fecha_desde, listasuc:"", solo_impstock:0 }),
      callOsweb("ventas_ls", { action:"unidades_sucursal_tipo", buscar_inicio:fecha_fin, buscar_fin:fecha_fin, listasuc:"", solo_impstock:0 }),
    ]);
    const hoy = parseTotalPorSuc(hoyData?.texto || hoyData?.raw || "");
    const ref = parseTotalPorSuc(refData?.texto || refData?.raw || "");
    // Solo porcentajes, nunca valores
    const variaciones = {};
    for (const suc of ["24SET","MENDO","MUÑE","SAL"]) {
      const h = hoy[suc]||0, a = ref[suc]||0;
      variaciones[suc] = a ? Number((((h-a)/a)*100).toFixed(1)) : null;
    }
    res.json({ ok: true, variaciones });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Servir front ──
app.use(express.static(path.join(__dirname, "client/dist")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "client/dist/index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard corriendo en puerto ${PORT}`));
