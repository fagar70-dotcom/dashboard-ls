let token = null;
export function setToken(t) { token = t; }
export function getToken() { return token; }

function headers() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };
}

export async function login(user, pass) {
  const r = await fetch("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, pass }),
  });
  return r.json();
}

export async function fetchVentas({ action, fecha_desde, fecha_fin, sucursales }) {
  const r = await fetch("/api/ventas", {
    method: "POST", headers: headers(),
    body: JSON.stringify({ action, fecha_desde, fecha_fin, sucursales }),
  });
  return r.json();
}

// Variaciones % de todos los locales (solo % — para encargados)
export async function fetchVariaciones(fecha_desde, fecha_fin) {
  const r = await fetch("/api/variaciones", {
    method: "POST", headers: headers(),
    body: JSON.stringify({ fecha_desde, fecha_fin }),
  });
  return r.json();
}

// ── Roles ──
export async function getRoles() {
  const r = await fetch("/api/roles", { headers: headers() });
  return r.json();
}
export async function saveRole(rol, data) {
  const r = await fetch(`/api/roles/${encodeURIComponent(rol)}`, { method: "PUT", headers: headers(), body: JSON.stringify(data) });
  return r.json();
}

// ── Usuarios (solo admin) ──
export async function getUsers() {
  const r = await fetch("/api/users", { headers: headers() });
  return r.json();
}
export async function saveUser(user, data) {
  // crea o actualiza (upsert) por PUT
  const r = await fetch(`/api/users/${encodeURIComponent(user)}`, { method: "PUT", headers: headers(), body: JSON.stringify(data) });
  return r.json();
}
export async function removeUser(user) {
  const r = await fetch(`/api/users/${encodeURIComponent(user)}`, { method: "DELETE", headers: headers() });
  return r.json();
}
