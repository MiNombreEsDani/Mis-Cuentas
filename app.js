// ═════════════════════════════════════════════════════════════
//  MIS CUENTAS · app principal
// ═════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const VICIOS = ['tabaco', 'fiesta', 'poker'];

const hoy = new Date();
const state = {
  user: null,
  perfil: null,
  categorias: [],
  movimientos: [],
  cuentas: [],
  inversiones: [],
  reglas: [],
  vista: 'resumen',
  mes: claveMes(hoy),
  anio: hoy.getFullYear(),
  trim: { anio: hoy.getFullYear(), q: Math.floor(hoy.getMonth() / 3) },
  filtro: 'todos',
  busqueda: '',
};

// ─────────────────────────── utilidades ───────────────────────────
const fmtEur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
function eur(n) { return fmtEur.format(Number(n) || 0); }
function pct(n) { return isFinite(n) ? `${Math.round(n * 100)}%` : '—'; }
function pad(n) { return String(n).padStart(2, '0'); }
function claveMes(d) { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function nombreMes(clave) { const [a, m] = clave.split('-'); return `${MESES[+m - 1]} ${a}`; }
function sumarMes(clave, n) { const [a, m] = clave.split('-').map(Number); return claveMes(new Date(a, m - 1 + n, 1)); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function clamp(x, a = 0, b = 1) { return Math.max(a, Math.min(b, x)); }
function fechaLarga(d) { return new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); }
function aLocalInput(d) { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function cat(id) { return state.categorias.find(c => c.id === id); }

function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (error ? ' error' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3000);
}
function fallo(error) { if (error) { console.error(error); toast(error.message || 'Error', true); return true; } return false; }

// ─────────────────────────── cálculos ───────────────────────────
function movsDe(filtro) { return state.movimientos.filter(filtro); }
const delMes = clave => m => claveMes(m.fecha) === clave;
const delAnio = anio => m => new Date(m.fecha).getFullYear() === anio;
const entreMeses = (desde, hasta) => m => { const k = claveMes(m.fecha); return k >= desde && k <= hasta; };

function resumen(movs) {
  let ingresos = 0, gastosBrutos = 0, compensaciones = 0;
  const porGasto = new Map(), porIngreso = new Map();
  for (const m of movs) {
    const imp = Number(m.importe);
    if (m.tipo === 'ingreso') { ingresos += imp; porIngreso.set(m.categoria_id, (porIngreso.get(m.categoria_id) || 0) + imp); }
    else if (m.tipo === 'gasto') { gastosBrutos += imp; porGasto.set(m.categoria_id, (porGasto.get(m.categoria_id) || 0) + imp); }
    else if (m.tipo === 'compensacion') { compensaciones += imp; porGasto.set(m.categoria_id, (porGasto.get(m.categoria_id) || 0) - imp); }
  }
  const gastos = gastosBrutos - compensaciones;
  const balance = ingresos - gastos;
  return { ingresos, gastos, gastosBrutos, compensaciones, balance, tasa: ingresos > 0 ? balance / ingresos : NaN, porGasto, porIngreso };
}

function lista(mapa, tipo) {
  return [...mapa.entries()]
    .map(([id, total]) => ({ c: cat(id) || { nombre: 'Sin categoría', icono: '❔', color: '#b0b7bd', tipo }, total }))
    .filter(x => Math.abs(x.total) > 0.004)
    .sort((a, b) => b.total - a.total);
}

function patrimonio() {
  const liquidez = state.cuentas.reduce((s, c) => s + Number(c.saldo), 0);
  const invertido = state.inversiones.reduce((s, i) => s + Number(i.valor_actual), 0);
  const aportado = state.inversiones.reduce((s, i) => s + Number(i.aportado), 0);
  return { liquidez, invertido, aportado, total: liquidez + invertido, plusvalia: invertido - aportado };
}

function diagnostico() {
  const actual = claveMes(hoy);
  // últimos 3 meses CON movimientos (dentro del último año), para no penalizar meses vacíos
  const conDatos = new Set(state.movimientos.map(m => claveMes(m.fecha)));
  const ventana = [];
  for (let i = 0; i < 12 && ventana.length < 3; i++) { const k = sumarMes(actual, -i); if (conDatos.has(k)) ventana.push(k); }
  const nMeses = Math.max(1, ventana.length);
  const r3 = resumen(movsDe(m => ventana.includes(claveMes(m.fecha))));
  const r12 = resumen(movsDe(entreMeses(sumarMes(actual, -11), actual)));
  const rMes = resumen(movsDe(delMes(actual)));
  const p = patrimonio();

  const partes = [];
  const consejos = [];

  // 1. Tasa de ahorro (30)
  const tasa = r3.ingresos > 0 ? r3.balance / r3.ingresos : (r3.gastos > 0 ? -1 : 0);
  partes.push({ nombre: 'Ahorro', max: 30, pts: clamp(tasa / 0.20) * 30,
    detalle: r3.ingresos > 0 ? `Ahorras el ${pct(tasa)} de lo que ingresas (últimos ${nMeses} meses con datos). Objetivo: 20%.` : 'No hay ingresos en los últimos 3 meses.' });
  if (tasa < 0.2) consejos.push(tasa < 0
    ? `Estás gastando más de lo que ingresas: ${eur(-r3.balance)} de déficit en tus últimos ${nMeses} meses. Prioriza recortar en tu categoría de mayor gasto.`
    : `Intenta apartar al menos el 20% de cada ingreso nada más recibirlo (ahora estás en ${pct(tasa)}).`);

  // 2. Colchón de emergencia (25)
  const gastoMedio = r3.gastos / nMeses;
  const mesesColchon = gastoMedio > 0 ? p.liquidez / gastoMedio : (p.liquidez > 0 ? 12 : 0);
  partes.push({ nombre: 'Colchón de emergencia', max: 25, pts: clamp(mesesColchon / 6) * 25,
    detalle: `Tu liquidez (${eur(p.liquidez)}) cubre ${mesesColchon.toFixed(1)} meses de gastos. Objetivo: 6 meses.` });
  if (mesesColchon < 6) consejos.push(`Para tener 6 meses de colchón te faltan ${eur(Math.max(0, gastoMedio * 6 - p.liquidez))}.`);

  // 3. Inversión (15)
  const ratioInv = p.total > 0 ? p.invertido / p.total : 0;
  partes.push({ nombre: 'Inversión', max: 15, pts: clamp(ratioInv / 0.25) * 15,
    detalle: `El ${pct(ratioInv)} de tu patrimonio está invertido. Objetivo: 25% o más.` });
  if (ratioInv < 0.25 && mesesColchon >= 3) consejos.push('Ya tienes algo de colchón: plantéate invertir una parte fija cada mes para que tu dinero supere la inflación.');

  // 4. Presupuestos (15)
  const conPres = state.categorias.filter(c => c.tipo === 'gasto' && Number(c.presupuesto) > 0);
  let ptsPres, detPres;
  if (!conPres.length) {
    ptsPres = 7.5; detPres = 'Aún no has puesto presupuestos a tus categorías.';
    consejos.push('Define un presupuesto mensual por categoría en Ajustes → Categorías para que pueda avisarte.');
  } else {
    const dentro = conPres.filter(c => (rMes.porGasto.get(c.id) || 0) <= Number(c.presupuesto));
    ptsPres = dentro.length / conPres.length * 15;
    detPres = `Este mes vas dentro del presupuesto en ${dentro.length} de ${conPres.length} categorías.`;
    conPres.filter(c => !dentro.includes(c)).forEach(c =>
      consejos.push(`${c.icono} ${c.nombre}: llevas ${eur(rMes.porGasto.get(c.id))} este mes y tu presupuesto es ${eur(c.presupuesto)}.`));
  }
  partes.push({ nombre: 'Presupuestos', max: 15, pts: ptsPres, detalle: detPres });

  // 5. Independencia (15): ingresos que generas tú vs paguitas/ayudas
  let generado = 0;
  for (const [id, t] of r12.porIngreso) if (!cat(id) || cat(id).generado) generado += t;
  const ratioGen = r12.ingresos > 0 ? generado / r12.ingresos : 0;
  partes.push({ nombre: 'Ingresos propios', max: 15, pts: ratioGen * 15,
    detalle: r12.ingresos > 0 ? `Generas tú el ${pct(ratioGen)} de tus ingresos (último año).` : 'Sin ingresos en el último año.' });

  // Avisos extra
  const totVicios = lista(r3.porGasto, 'gasto').filter(x => VICIOS.includes(x.c.nombre?.toLowerCase())).reduce((s, x) => s + x.total, 0);
  if (r3.gastos > 0 && totVicios / r3.gastos > 0.3)
    consejos.push(`Tabaco, fiesta y poker suponen el ${pct(totVicios / r3.gastos)} de tus gastos recientes (${eur(totVicios)}).`);
  const pokerG = state.categorias.find(c => c.tipo === 'gasto' && c.nombre.toLowerCase() === 'poker');
  const pokerI = state.categorias.find(c => c.tipo === 'ingreso' && c.nombre.toLowerCase() === 'poker');
  if (pokerG) {
    const neto = (pokerI ? r12.porIngreso.get(pokerI.id) || 0 : 0) - (r12.porGasto.get(pokerG.id) || 0);
    if (neto < 0) consejos.push(`En el poker vas perdiendo ${eur(-neto)} en el último año.`);
  }

  const total = Math.round(partes.reduce((s, x) => s + x.pts, 0));
  const nivel = total >= 80 ? ['Excelente', 'bien'] : total >= 60 ? ['Buena', 'bien'] : total >= 40 ? ['Mejorable', 'medio'] : ['Delicada', 'mal'];
  return { total, nivel, partes, consejos };
}

// ─────────────────────────── datos ───────────────────────────
async function cargarTodo() {
  const [perfil, categorias, cuentas, inversiones, reglas] = await Promise.all([
    sb.from('perfil').select('*').maybeSingle(),
    sb.from('categorias').select('*').order('tipo').order('orden').order('nombre'),
    sb.from('cuentas').select('*').order('id'),
    sb.from('inversiones').select('*').order('id'),
    sb.from('reglas').select('*').order('patron'),
  ]);
  for (const r of [perfil, categorias, cuentas, inversiones, reglas]) if (fallo(r.error)) return;
  state.perfil = perfil.data; state.categorias = categorias.data; state.cuentas = cuentas.data;
  state.inversiones = inversiones.data; state.reglas = reglas.data;
  // movimientos (paginado de 1000 en 1000)
  const todos = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from('movimientos').select('*').order('fecha', { ascending: false }).range(desde, desde + 999);
    if (fallo(error)) return;
    todos.push(...data);
    if (data.length < 1000) break;
  }
  state.movimientos = todos;
}

async function recargar() { await cargarTodo(); pintar(); }

// ─────────────────────────── navegación ───────────────────────────
function irA(vista) {
  state.vista = vista;
  $$('[data-vista]').forEach(b => b.classList.toggle('activo', b.dataset.vista === vista));
  $('#fab').hidden = !['resumen', 'movimientos'].includes(vista);
  pintar();
  window.scrollTo(0, 0);
}

function pintar() {
  const v = $('#vista');
  const vistas = { resumen: vResumen, movimientos: vMovimientos, informe: vInforme, patrimonio: vPatrimonio, salud: vSalud, ajustes: vAjustes };
  v.innerHTML = vistas[state.vista]();
  if (state.vista === 'ajustes') cargarNotificaciones();
}

function selectorMes() {
  return `<div class="selector">
    <button class="btn-icono" data-accion="mes" data-n="-1" aria-label="Mes anterior">‹</button>
    <strong>${nombreMes(state.mes)}</strong>
    <button class="btn-icono" data-accion="mes" data-n="1" aria-label="Mes siguiente">›</button>
  </div>`;
}

// ─────────────────────────── vista: resumen ───────────────────────────
function barras(items, total, conPresupuesto = false) {
  if (!items.length) return '<p class="vacio">Sin datos este periodo.</p>';
  // los porcentajes se calculan sobre las categorías en positivo (una categoría
  // puede quedar en negativo si te han compensado más de lo que gastaste ese mes)
  total = items.reduce((s, i) => s + Math.max(0, i.total), 0);
  const max = Math.max(1, ...items.map(i => i.total), ...items.map(i => conPresupuesto ? Number(i.c.presupuesto) || 0 : 0));
  return `<ul class="barras">${items.map(({ c, total: t }) => {
    const pres = conPresupuesto ? Number(c.presupuesto) || 0 : 0;
    const pasado = pres && t > pres;
    return `<li>
      <div class="barra-cab"><span>${esc(c.icono)} ${esc(c.nombre)}</span>
        <span><b>${eur(t)}</b> <small>${t < 0 ? 'compensado' : total > 0 ? pct(t / total) : ''}${pres ? ` · de ${eur(pres)}` : ''}</small></span></div>
      <div class="barra"><i style="width:${clamp(t / max) * 100}%;background:${pasado ? 'var(--rojo)' : esc(c.color)}"></i>
        ${pres ? `<em style="left:${clamp(pres / max) * 100}%"></em>` : ''}</div>
    </li>`; }).join('')}</ul>`;
}

function filaMov(m) {
  const c = cat(m.categoria_id);
  const signo = m.tipo === 'gasto' ? '−' : '+';
  const clase = m.tipo === 'gasto' ? 'neg' : m.tipo === 'ingreso' ? 'pos' : 'comp';
  const sub = m.tipo === 'compensacion' ? `Compensa ${c ? esc(c.nombre) : '—'}` : (c ? esc(c.nombre) : 'Sin categoría');
  return `<li class="mov" data-accion="editar-mov" data-id="${m.id}">
    <span class="mov-ico" style="background:${c ? esc(c.color) : '#b0b7bd'}22">${c ? esc(c.icono) : '❔'}</span>
    <span class="mov-txt"><b>${esc(m.concepto || '(sin concepto)')}</b>
      <small>${sub}${m.revisar ? ' · <span class="chip-rev">Revisar</span>' : ''}${m.origen === 'notificacion' ? ' · 🔔' : ''}</small></span>
    <span class="mov-imp ${clase}">${signo}${eur(m.importe)}</span>
  </li>`;
}

function vResumen() {
  const movs = movsDe(delMes(state.mes));
  const r = resumen(movs);
  const pendientes = state.movimientos.filter(m => m.revisar).length;
  const mensaje = !r.ingresos && !r.gastos ? '' : r.balance < 0
    ? (r.ingresos > 0 ? `Vives un <b>${pct(-r.balance / r.ingresos)}</b> por encima de tus posibilidades este mes.` : `Este mes llevas <b>${eur(r.gastos)}</b> gastados sin ingresos.`)
    : `Has ahorrado un <b>${pct(r.tasa)}</b> de tus ingresos este mes.`;
  return `
    ${selectorMes()}
    ${pendientes ? `<button class="aviso" data-accion="ver-revisar">🔔 Tienes <b>${pendientes}</b> movimiento${pendientes > 1 ? 's' : ''} por revisar →</button>` : ''}
    <div class="kpis">
      <div class="kpi"><small>Ingresos</small><b class="pos">${eur(r.ingresos)}</b></div>
      <div class="kpi"><small>Gastos</small><b class="neg">${eur(r.gastos)}</b>${r.compensaciones ? `<small class="nota">ya restados ${eur(r.compensaciones)} de compensaciones</small>` : ''}</div>
      <div class="kpi"><small>Balance</small><b class="${r.balance < 0 ? 'neg' : 'pos'}">${eur(r.balance)}</b></div>
    </div>
    ${mensaje ? `<p class="frase ${r.balance < 0 ? 'mal' : 'bien'}">${mensaje}</p>` : ''}
    <section class="tarjeta"><h2>Distribución de gastos</h2>${barras(lista(r.porGasto, 'gasto'), r.gastos, true)}</section>
    <section class="tarjeta"><h2>Distribución de ingresos</h2>${barras(lista(r.porIngreso, 'ingreso'), r.ingresos)}</section>
    <section class="tarjeta"><h2>Últimos movimientos</h2>
      ${movs.length ? `<ul class="movs">${movs.slice(0, 6).map(filaMov).join('')}</ul>
      <button class="btn btn-sec ancho" data-accion="ir" data-vista="movimientos">Ver todos</button>` : '<p class="vacio">No hay movimientos este mes.</p>'}
    </section>`;
}

// ─────────────────────────── vista: movimientos ───────────────────────────
function vMovimientos() {
  const q = state.busqueda.toLowerCase();
  let movs = state.filtro === 'revisar' ? state.movimientos.filter(m => m.revisar) : movsDe(delMes(state.mes));
  if (state.filtro === 'gastos') movs = movs.filter(m => m.tipo === 'gasto');
  if (state.filtro === 'ingresos') movs = movs.filter(m => m.tipo !== 'gasto');
  if (q) movs = movs.filter(m => (m.concepto + ' ' + (m.descripcion || '') + ' ' + (cat(m.categoria_id)?.nombre || '')).toLowerCase().includes(q));

  const grupos = new Map();
  for (const m of movs) { const k = new Date(m.fecha).toDateString(); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(m); }
  const chips = [['todos', 'Todos'], ['gastos', 'Gastos'], ['ingresos', 'Ingresos'], ['revisar', 'Por revisar']];
  return `
    ${state.filtro === 'revisar' ? '<h2 class="titulo">Por revisar</h2>' : selectorMes()}
    <div class="chips">${chips.map(([k, t]) => `<button class="chip ${state.filtro === k ? 'activo' : ''}" data-accion="filtro" data-f="${k}">${t}</button>`).join('')}</div>
    <input type="search" class="buscar" id="buscar" placeholder="Buscar concepto o categoría…" value="${esc(state.busqueda)}">
    ${movs.length ? [...grupos.values()].map(g => `
      <h3 class="dia">${fechaLarga(g[0].fecha)}</h3>
      <ul class="movs tarjeta">${g.map(filaMov).join('')}</ul>`).join('')
      : `<p class="vacio">${state.filtro === 'revisar' ? '¡Todo revisado! 🎉' : 'No hay movimientos.'}</p>`}`;
}

// ─────────────────────────── vista: informe trimestral ───────────────────────────
function vInforme() {
  const { anio, q } = state.trim;
  const enTrim = (a, t) => m => { const d = new Date(m.fecha); return d.getFullYear() === a && Math.floor(d.getMonth() / 3) === t; };
  const movs = movsDe(enTrim(anio, q));
  const r = resumen(movs);
  const tAnt = anio * 4 + q - 1;
  const rAnt = resumen(movsDe(enTrim(Math.floor(tAnt / 4), tAnt % 4)));
  const dif = (a, b) => b > 0 ? `<small class="nota">${a >= b ? '▲' : '▼'} ${pct(Math.abs(a - b) / b)} vs trimestre anterior</small>` : '';

  // detalle de una categoría: sus movimientos agrupados por concepto, de mayor a menor
  const detalle = (c, esGasto) => {
    const g = new Map();
    for (const m of movs) {
      if ((m.categoria_id ?? null) !== (c.id ?? null)) continue;
      if (esGasto ? m.tipo === 'ingreso' : m.tipo !== 'ingreso') continue;
      const comp = m.tipo === 'compensacion';
      const nombre = comp ? '↩ Compensaciones recibidas' : (m.concepto || '(sin concepto)').trim();
      const k = nombre.toLowerCase();
      const e = g.get(k) || { nombre, total: 0, n: 0 };
      e.total += comp ? -Number(m.importe) : Number(m.importe); e.n++;
      g.set(k, e);
    }
    return [...g.values()].sort((a, b) => b.total - a.total).map(e =>
      `<li><span>${esc(e.nombre)}${e.n > 1 ? ` <small>×${e.n}</small>` : ''}</span><b>${eur(e.total)}</b></li>`).join('');
  };

  const ranking = (items, esGasto) => {
    if (!items.length) return '<p class="vacio">Sin datos este trimestre.</p>';
    const total = items.reduce((s, i) => s + Math.max(0, i.total), 0);
    const max = Math.max(1, items[0].total);
    return `<ol class="ranking">${items.map(({ c, total: t }, i) => `<li><details>
      <summary>
        <span class="pos-n">${i + 1}</span>
        <span class="rk-txt"><span class="barra-cab"><span>${esc(c.icono)} ${esc(c.nombre)}</span>
          <span><b>${eur(t)}</b> <small>${t < 0 ? 'compensado' : total > 0 ? pct(t / total) : ''}</small></span></span>
          <span class="barra"><i style="width:${clamp(t / max) * 100}%;background:${esc(c.color)}"></i></span></span>
      </summary>
      <ul class="filas peq detalle">${detalle(c, esGasto)}</ul>
    </details></li>`).join('')}</ol>`;
  };

  return `
    <div class="selector">
      <button class="btn-icono" data-accion="trim" data-n="-1" aria-label="Trimestre anterior">‹</button>
      <strong>${q + 1}.º trimestre ${anio}<small class="rango">${MESES[q * 3]} – ${MESES[q * 3 + 2]}</small></strong>
      <button class="btn-icono" data-accion="trim" data-n="1" aria-label="Trimestre siguiente">›</button>
    </div>
    <div class="kpis">
      <div class="kpi"><small>Ingresos</small><b class="pos">${eur(r.ingresos)}</b>${dif(r.ingresos, rAnt.ingresos)}</div>
      <div class="kpi"><small>Gastos</small><b class="neg">${eur(r.gastos)}</b>${dif(r.gastos, rAnt.gastos)}</div>
      <div class="kpi"><small>Balance</small><b class="${r.balance < 0 ? 'neg' : 'pos'}">${eur(r.balance)}</b></div>
    </div>
    <section class="tarjeta"><h2>Gastos por concepto, de mayor a menor</h2>${ranking(lista(r.porGasto, 'gasto'), true)}</section>
    <section class="tarjeta"><h2>Ingresos por concepto, de mayor a menor</h2>${ranking(lista(r.porIngreso, 'ingreso'), false)}</section>
    <p class="ayuda centro">Toca un concepto para ver el detalle de sus movimientos.</p>`;
}

// ─────────────────────────── vista: patrimonio ───────────────────────────
function vPatrimonio() {
  const p = patrimonio();
  const rAnio = resumen(movsDe(delAnio(hoy.getFullYear())));
  const inflacion = Number(state.perfil?.inflacion ?? 3) / 100;
  const objetivo = p.total * inflacion;
  const generado = rAnio.balance + p.plusvalia;
  return `
    <div class="kpis dos">
      <div class="kpi grande"><small>Patrimonio total</small><b>${eur(p.total)}</b></div>
      <div class="kpi"><small>Liquidez</small><b>${eur(p.liquidez)}</b></div>
      <div class="kpi"><small>Invertido</small><b>${eur(p.invertido)}</b>
        ${p.aportado ? `<small class="${p.plusvalia < 0 ? 'neg' : 'pos'}">${p.plusvalia >= 0 ? '+' : ''}${eur(p.plusvalia)} (${pct(p.plusvalia / p.aportado)})</small>` : ''}</div>
    </div>

    <section class="tarjeta">
      <div class="tarjeta-cab"><h2>Cuentas y efectivo</h2><button class="btn btn-sec peq" data-accion="nueva-cuenta">+ Añadir</button></div>
      ${state.cuentas.length ? `<ul class="filas">${state.cuentas.map(c => `
        <li data-accion="editar-cuenta" data-id="${c.id}"><span>${{ corriente: '🏦', ahorro: '🐷', efectivo: '💵' }[c.tipo] || '🏦'} ${esc(c.nombre)}</span><b>${eur(c.saldo)}</b></li>`).join('')}</ul>`
      : '<p class="vacio">Añade tus cuentas para calcular tu colchón de emergencia.</p>'}
    </section>

    <section class="tarjeta">
      <div class="tarjeta-cab"><h2>Inversiones</h2><button class="btn btn-sec peq" data-accion="nueva-inv">+ Añadir</button></div>
      ${state.inversiones.length ? `<ul class="filas">${state.inversiones.map(i => {
        const g = i.valor_actual - i.aportado;
        return `<li data-accion="editar-inv" data-id="${i.id}"><span>📈 ${esc(i.nombre)} <small>${esc(i.tipo)} · aportado ${eur(i.aportado)}</small></span>
          <span class="der"><b>${eur(i.valor_actual)}</b><small class="${g < 0 ? 'neg' : 'pos'}">${g >= 0 ? '+' : ''}${eur(g)}${Number(i.aportado) ? ` (${pct(g / i.aportado)})` : ''}</small></span></li>`; }).join('')}</ul>`
      : '<p class="vacio">Aún no has añadido inversiones.</p>'}
      <p class="ayuda">Actualiza el valor actual de vez en cuando (por ejemplo, una vez al mes).</p>
    </section>

    <section class="tarjeta">
      <h2>Objetivos ${hoy.getFullYear()}</h2>
      <div class="objetivo">
        <div class="barra-cab"><span>Superar la inflación (${pct(inflacion)})</span><span><b>${eur(generado)}</b> de ${eur(objetivo)}</span></div>
        <div class="barra"><i style="width:${objetivo > 0 ? clamp(generado / objetivo) * 100 : 0}%;background:${generado >= objetivo ? 'var(--verde)' : 'var(--naranja)'}"></i></div>
        <p class="ayuda">${generado >= objetivo ? '✅ Este año tu dinero crece más rápido que la inflación.' : `Necesitas generar ${eur(objetivo - generado)} más este año (ahorro + plusvalías) para no perder poder adquisitivo.`}</p>
      </div>
      <div class="objetivo">
        <div class="barra-cab"><span>Balance neto ≥ 0 (ingresos − gastos)</span><b class="${rAnio.balance < 0 ? 'neg' : 'pos'}">${eur(rAnio.balance)}</b></div>
        <p class="ayuda">${rAnio.balance < 0 ? `Faltan por generar ${eur(-rAnio.balance)}.` : `Se tienen ${eur(rAnio.balance)} de más. 👍`}</p>
      </div>
    </section>`;
}

// ─────────────────────────── vista: salud ───────────────────────────
function vSalud() {
  const d = diagnostico();
  const a = state.anio;
  const rA = resumen(movsDe(delAnio(a)));
  const gastos = lista(rA.porGasto, 'gasto');
  let generado = 0;
  for (const [id, t] of rA.porIngreso) if (!cat(id) || cat(id).generado) generado += t;

  // evolución mensual
  const meses = MESES.map((n, i) => ({ n: n.slice(0, 3), r: resumen(movsDe(delMes(`${a}-${pad(i + 1)}`))) }));
  const max = Math.max(1, ...meses.map(m => Math.max(m.r.ingresos, m.r.gastos)));

  const frases = [];
  if (rA.ingresos || rA.gastos) {
    frases.push(rA.balance < 0
      ? `Vives un <b>${rA.ingresos ? pct(-rA.balance / rA.ingresos) : '—'}</b> por encima de tus posibilidades.`
      : `Has ahorrado un <b>${pct(rA.tasa)}</b> de tus ingresos.`);
    if (rA.ingresos) frases.push(`Has generado tú un <b>${pct(generado / rA.ingresos)}</b> de tus ingresos; el <b>${pct(1 - generado / rA.ingresos)}</b> son paguitas o ayudas.`);
    if (gastos.length && rA.gastos > 0) frases.push(`Tu mayor gasto este año ha sido <b>${esc(gastos[0].c.nombre)}</b>, un <b>${pct(gastos[0].total / rA.gastos)}</b> del total.`);
  }

  return `
    <section class="tarjeta salud">
      <div class="anillo ${d.nivel[1]}" style="--p:${d.total}"><span><b>${d.total}</b><small>/100</small></span></div>
      <div><h2>Salud financiera: ${d.nivel[0]}</h2><p class="ayuda">Calculada con tus últimos meses con movimientos, tu patrimonio y tus presupuestos.</p></div>
    </section>
    <section class="tarjeta"><h2>Desglose</h2>
      <ul class="barras">${d.partes.map(p => `<li>
        <div class="barra-cab"><span>${p.nombre}</span><span><b>${Math.round(p.pts)}</b>/${p.max}</span></div>
        <div class="barra"><i style="width:${p.pts / p.max * 100}%;background:${p.pts / p.max >= .66 ? 'var(--verde)' : p.pts / p.max >= .33 ? 'var(--naranja)' : 'var(--rojo)'}"></i></div>
        <p class="ayuda">${p.detalle}</p></li>`).join('')}</ul>
    </section>
    ${d.consejos.length ? `<section class="tarjeta"><h2>Recomendaciones</h2><ul class="consejos">${d.consejos.map(c => `<li>${esc(c)}</li>`).join('')}</ul></section>` : ''}

    <div class="selector">
      <button class="btn-icono" data-accion="anio" data-n="-1">‹</button><strong>Año ${a}</strong><button class="btn-icono" data-accion="anio" data-n="1">›</button>
    </div>
    <div class="kpis">
      <div class="kpi"><small>Ingresos ${a}</small><b class="pos">${eur(rA.ingresos)}</b></div>
      <div class="kpi"><small>Gastos ${a}</small><b class="neg">${eur(rA.gastos)}</b></div>
      <div class="kpi"><small>Balance ${a}</small><b class="${rA.balance < 0 ? 'neg' : 'pos'}">${eur(rA.balance)}</b></div>
    </div>
    ${frases.length ? `<section class="tarjeta">${frases.map(f => `<p class="frase-linea">${f}</p>`).join('')}</section>` : ''}
    <section class="tarjeta"><h2>Evolución mensual</h2>
      <div class="grafico">${meses.map(m => `<div class="col" title="${m.n}: +${eur(m.r.ingresos)} / −${eur(m.r.gastos)}">
        <div class="pares"><i class="ing" style="height:${m.r.ingresos / max * 100}%"></i><i class="gas" style="height:${Math.max(0, m.r.gastos) / max * 100}%"></i></div>
        <small>${m.n}</small></div>`).join('')}</div>
      <p class="leyenda"><i class="ing"></i> Ingresos <i class="gas"></i> Gastos</p>
    </section>
    <section class="tarjeta"><h2>Gastos por categoría en ${a}</h2>${barras(gastos, rA.gastos)}</section>`;
}

// ─────────────────────────── vista: ajustes ───────────────────────────
function vAjustes() {
  const p = state.perfil || {};
  const url = `${SUPABASE_URL}/rest/v1/rpc/registrar_notificacion`;
  const cuerpo = `{"p_token":"${p.token_ingesta}","p_titulo":"[notification_title]","p_texto":"[notification]"}`;
  const cats = t => state.categorias.filter(c => c.tipo === t);
  return `
    <section class="tarjeta">
      <h2>Tu cuenta</h2>
      <p class="ayuda">Conectado como <b>${esc(state.user?.email)}</b></p>
      <form id="form-perfil" class="form-linea">
        <label>Ingresos fijos al mes<input name="ingresos_fijos" type="number" step="0.01" value="${p.ingresos_fijos ?? 0}"></label>
        <label>Inflación objetivo (%)<input name="inflacion" type="number" step="0.1" value="${p.inflacion ?? 3}"></label>
        <button class="btn btn-primario">Guardar</button>
      </form>
    </section>

    <section class="tarjeta">
      <h2>🔔 Conexión con las notificaciones del Sabadell</h2>
      <p class="ayuda">En MacroDroid crea una acción <b>Petición HTTP</b> con estos datos (toca para copiar):</p>
      <div class="copiar" data-copiar="${esc(url)}"><small>URL (método POST)</small><code>${esc(url)}</code></div>
      <div class="copiar" data-copiar="${esc(SUPABASE_KEY)}"><small>Cabecera <b>apikey</b></small><code>${esc(SUPABASE_KEY)}</code></div>
      <div class="copiar" data-copiar="application/json"><small>Cabecera <b>Content-Type</b></small><code>application/json</code></div>
      <div class="copiar" data-copiar="${esc(cuerpo)}"><small>Cuerpo (body)</small><code>${esc(cuerpo)}</code></div>
      <p class="ayuda">El token es secreto: quien lo tenga puede añadir movimientos a tu cuenta.</p>
      <div class="fila-botones">
        <button class="btn btn-sec" data-accion="probar">Probar con una notificación de ejemplo</button>
        <button class="btn btn-sec" data-accion="nuevo-token">Cambiar token</button>
      </div>
      <h3>Últimas notificaciones recibidas</h3>
      <ul class="filas peq" id="lista-notis"><li class="vacio">Cargando…</li></ul>
    </section>

    <section class="tarjeta">
      <div class="tarjeta-cab"><h2>Categorías</h2><button class="btn btn-sec peq" data-accion="nueva-cat">+ Añadir</button></div>
      ${['gasto', 'ingreso'].map(t => `<h3>${t === 'gasto' ? 'Gastos' : 'Ingresos'}</h3><ul class="filas">${cats(t).map(c => `
        <li data-accion="editar-cat" data-id="${c.id}"><span><i class="punto" style="background:${esc(c.color)}"></i>${esc(c.icono)} ${esc(c.nombre)}</span>
        <small>${t === 'gasto' ? (c.presupuesto ? `Presupuesto ${eur(c.presupuesto)}/mes` : 'Sin presupuesto') : (c.generado ? 'Generado por ti' : 'Paguita / ayuda')}</small></li>`).join('')}</ul>`).join('')}
    </section>

    <section class="tarjeta">
      <div class="tarjeta-cab"><h2>Reglas automáticas</h2><button class="btn btn-sec peq" data-accion="nueva-regla">+ Añadir</button></div>
      <p class="ayuda">Si el concepto de una compra contiene el texto, se le pone esa categoría sola.</p>
      <ul class="filas">${state.reglas.map(r => { const c = cat(r.categoria_id); return `
        <li><span><code>${esc(r.patron)}</code> → ${c ? `${esc(c.icono)} ${esc(c.nombre)}` : '—'}</span>
        <button class="btn-icono" data-accion="borrar-regla" data-id="${r.id}" aria-label="Borrar">✕</button></li>`; }).join('')}</ul>
    </section>

    <section class="tarjeta">
      <h2>Otros</h2>
      <div class="fila-botones">
        <button class="btn btn-sec" data-accion="exportar">⬇️ Exportar movimientos (CSV)</button>
        ${instalarEvento ? '<button class="btn btn-sec" data-accion="instalar">📲 Instalar la app</button>' : ''}
        <button class="btn btn-sec" data-accion="password">🔑 Cambiar contraseña</button>
        <button class="btn btn-peligro" data-accion="salir">Cerrar sesión</button>
      </div>
    </section>`;
}

async function cargarNotificaciones() {
  const { data, error } = await sb.from('notificaciones').select('*').order('recibida', { ascending: false }).limit(15);
  const ul = $('#lista-notis'); if (!ul) return;
  if (error) { ul.innerHTML = `<li class="vacio">${esc(error.message)}</li>`; return; }
  ul.innerHTML = data.length ? data.map(n => `<li><span><small>${new Date(n.recibida).toLocaleString('es-ES')}</small>${esc(n.texto)}</span>
    <span class="estado ${n.resultado}">${n.resultado}</span></li>`).join('') : '<li class="vacio">Todavía no ha llegado ninguna.</li>';
}

// ─────────────────────────── formularios (modal) ───────────────────────────
function abrirFormulario({ titulo, campos, onGuardar, onBorrar, alCambiar }) {
  const dlg = $('#modal');
  dlg.innerHTML = `<form method="dialog" class="form-modal">
    <h2>${titulo}</h2>
    ${campos.map(campoHTML).join('')}
    <div class="fila-botones">
      ${onBorrar ? '<button type="button" class="btn btn-peligro" data-borrar>Borrar</button>' : ''}
      <span class="flex"></span>
      <button type="button" class="btn btn-sec" data-cancelar>Cancelar</button>
      <button type="submit" class="btn btn-primario">Guardar</button>
    </div></form>`;
  const form = $('form', dlg);
  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    $$('input[type=checkbox]', form).forEach(c => (datos[c.name] = c.checked));
    const ok = await onGuardar(datos);
    if (ok !== false) { dlg.close(); await recargar(); }
  };
  $('[data-cancelar]', form).onclick = () => dlg.close();
  if (onBorrar) $('[data-borrar]', form).onclick = async () => {
    if (!confirm('¿Seguro que quieres borrarlo?')) return;
    if (await onBorrar() !== false) { dlg.close(); await recargar(); }
  };
  if (alCambiar) { form.addEventListener('change', () => alCambiar(form)); alCambiar(form); }
  dlg.showModal();
}

function campoHTML(c) {
  const v = esc(c.value ?? '');
  if (c.type === 'select') return `<label class="${c.clase || ''}">${c.label}<select name="${c.name}">${c.options.map(o =>
    `<option value="${esc(o.value)}" ${String(o.value) === String(c.value ?? '') ? 'selected' : ''} ${o.grupo ? `data-grupo="${o.grupo}"` : ''}>${esc(o.text)}</option>`).join('')}</select></label>`;
  if (c.type === 'checkbox') return `<label class="check ${c.clase || ''}"><input type="checkbox" name="${c.name}" ${c.value ? 'checked' : ''}> ${c.label}</label>`;
  if (c.type === 'textarea') return `<label>${c.label}<textarea name="${c.name}" rows="2">${v}</textarea></label>`;
  if (c.type === 'info') return `<p class="ayuda">${c.label}</p>`;
  return `<label class="${c.clase || ''}">${c.label}<input name="${c.name}" type="${c.type || 'text'}" value="${v}" ${c.step ? `step="${c.step}"` : ''} ${c.required ? 'required' : ''} ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}></label>`;
}

function opcionesCategoria() {
  return [{ value: '', text: '— Sin categoría —' }, ...state.categorias.map(c => ({ value: c.id, text: `${c.icono} ${c.nombre}`, grupo: c.tipo }))];
}

function formMovimiento(m = null) {
  const nuevo = !m;
  m = m || { tipo: 'gasto', importe: '', concepto: '', fecha: new Date().toISOString(), categoria_id: null, descripcion: '' };
  abrirFormulario({
    titulo: nuevo ? 'Nuevo movimiento' : 'Editar movimiento',
    campos: [
      { name: 'tipo', label: 'Tipo', type: 'select', value: m.tipo, options: [
        { value: 'gasto', text: '− Gasto' }, { value: 'ingreso', text: '+ Ingreso' }, { value: 'compensacion', text: '↩ Compensación (me devuelven un gasto)' }] },
      { name: 'importe', label: 'Importe (€)', type: 'number', step: '0.01', value: m.importe, required: true },
      { name: 'concepto', label: 'Concepto', value: m.concepto, required: true },
      { name: 'categoria_id', label: 'Categoría', type: 'select', value: m.categoria_id ?? '', options: opcionesCategoria() },
      { name: 'fecha', label: 'Fecha', type: 'datetime-local', value: aLocalInput(m.fecha), required: true },
      { name: 'descripcion', label: 'Notas', type: 'textarea', value: m.descripcion },
      ...(m.origen === 'notificacion' ? [
        { name: 'crear_regla', label: 'Usar esta categoría siempre para este concepto', type: 'checkbox', clase: 'solo-gasto' },
        { name: 'patron', label: 'Texto que debe contener el concepto', value: (m.concepto || '').split(' ').slice(0, 2).join(' '), clase: 'solo-gasto' },
        { type: 'info', label: `Notificación original: «${esc(m.texto_original)}»` }] : []),
      ...(m.tipo === 'ingreso' && m.origen === 'notificacion' ? [{ type: 'info', label: '💡 ¿Es un Bizum que te devuelve un amigo por algo que pagaste tú? Elige «Compensación» y la categoría del gasto (p. ej. Fiesta): así no cuenta como ingreso y reduce ese gasto.' }] : []),
    ],
    alCambiar: form => {
      const tipo = form.tipo.value;
      const grupo = tipo === 'ingreso' ? 'ingreso' : 'gasto';
      $$('option[data-grupo]', form.categoria_id).forEach(o => { o.hidden = o.dataset.grupo !== grupo; });
      if (form.categoria_id.selectedOptions[0]?.hidden) form.categoria_id.value = '';
      $$('.solo-gasto', form).forEach(el => (el.hidden = tipo === 'ingreso'));
    },
    onGuardar: async d => {
      const fila = {
        tipo: d.tipo, importe: Math.abs(parseFloat(String(d.importe).replace(',', '.'))), concepto: d.concepto.trim(),
        categoria_id: d.categoria_id ? Number(d.categoria_id) : null, fecha: new Date(d.fecha).toISOString(),
        descripcion: d.descripcion || null, revisar: false,
      };
      if (d.tipo === 'compensacion' && !fila.categoria_id) { toast('Elige qué categoría de gasto compensa', true); return false; }
      const { error } = nuevo ? await sb.from('movimientos').insert(fila) : await sb.from('movimientos').update(fila).eq('id', m.id);
      if (fallo(error)) return false;
      if (d.crear_regla && d.patron?.trim() && fila.categoria_id && d.tipo !== 'ingreso') {
        const { error: e2 } = await sb.from('reglas').upsert({ patron: d.patron.trim().toUpperCase(), categoria_id: fila.categoria_id, user_id: state.user.id }, { onConflict: 'user_id,patron' });
        if (!fallo(e2)) toast('Regla guardada');
      } else toast('Guardado');
    },
    onBorrar: nuevo ? null : async () => !fallo((await sb.from('movimientos').delete().eq('id', m.id)).error),
  });
}

function formCuenta(c = null) {
  abrirFormulario({
    titulo: c ? 'Editar cuenta' : 'Nueva cuenta',
    campos: [
      { name: 'nombre', label: 'Nombre', value: c?.nombre, required: true, placeholder: 'Cuenta Sabadell' },
      { name: 'tipo', label: 'Tipo', type: 'select', value: c?.tipo || 'ahorro', options: [
        { value: 'corriente', text: '🏦 Cuenta corriente' }, { value: 'ahorro', text: '🐷 Cuenta de ahorro' }, { value: 'efectivo', text: '💵 Efectivo' }] },
      { name: 'saldo', label: 'Saldo actual (€)', type: 'number', step: '0.01', value: c?.saldo ?? 0, required: true },
    ],
    onGuardar: async d => {
      const fila = { nombre: d.nombre, tipo: d.tipo, saldo: Number(d.saldo), actualizado: new Date().toISOString() };
      return !fallo((c ? await sb.from('cuentas').update(fila).eq('id', c.id) : await sb.from('cuentas').insert(fila)).error);
    },
    onBorrar: c ? async () => !fallo((await sb.from('cuentas').delete().eq('id', c.id)).error) : null,
  });
}

function formInversion(i = null) {
  abrirFormulario({
    titulo: i ? 'Editar inversión' : 'Nueva inversión',
    campos: [
      { name: 'nombre', label: 'Nombre', value: i?.nombre, required: true, placeholder: 'Fondo indexado MSCI World' },
      { name: 'tipo', label: 'Tipo', type: 'select', value: i?.tipo || 'Fondo', options: ['Fondo', 'ETF', 'Acciones', 'Cripto', 'Depósito', 'Plan de pensiones', 'Otro'].map(x => ({ value: x, text: x })) },
      { name: 'aportado', label: 'Dinero aportado (€)', type: 'number', step: '0.01', value: i?.aportado ?? 0 },
      { name: 'valor_actual', label: 'Valor actual (€)', type: 'number', step: '0.01', value: i?.valor_actual ?? 0 },
    ],
    onGuardar: async d => {
      const fila = { nombre: d.nombre, tipo: d.tipo, aportado: Number(d.aportado), valor_actual: Number(d.valor_actual), actualizado: new Date().toISOString() };
      return !fallo((i ? await sb.from('inversiones').update(fila).eq('id', i.id) : await sb.from('inversiones').insert(fila)).error);
    },
    onBorrar: i ? async () => !fallo((await sb.from('inversiones').delete().eq('id', i.id)).error) : null,
  });
}

function formCategoria(c = null) {
  abrirFormulario({
    titulo: c ? 'Editar categoría' : 'Nueva categoría',
    campos: [
      { name: 'nombre', label: 'Nombre', value: c?.nombre, required: true },
      { name: 'tipo', label: 'Tipo', type: 'select', value: c?.tipo || 'gasto', options: [{ value: 'gasto', text: 'Gasto' }, { value: 'ingreso', text: 'Ingreso' }] },
      { name: 'icono', label: 'Icono (emoji)', value: c?.icono || '•' },
      { name: 'color', label: 'Color', type: 'color', value: c?.color || '#2e9e5b' },
      { name: 'presupuesto', label: 'Presupuesto mensual (€, opcional)', type: 'number', step: '0.01', value: c?.presupuesto ?? '', clase: 'solo-gasto' },
      { name: 'generado', label: 'Lo genero yo (desmárcalo si es una paguita o ayuda)', type: 'checkbox', value: c ? c.generado : true, clase: 'solo-ingreso' },
    ],
    alCambiar: form => {
      $$('.solo-gasto', form).forEach(el => (el.hidden = form.tipo.value !== 'gasto'));
      $$('.solo-ingreso', form).forEach(el => (el.hidden = form.tipo.value !== 'ingreso'));
    },
    onGuardar: async d => {
      const fila = { nombre: d.nombre.trim(), tipo: d.tipo, icono: d.icono || '•', color: d.color,
        presupuesto: d.tipo === 'gasto' && d.presupuesto ? Number(d.presupuesto) : null, generado: d.tipo === 'ingreso' ? !!d.generado : true };
      return !fallo((c ? await sb.from('categorias').update(fila).eq('id', c.id) : await sb.from('categorias').insert(fila)).error);
    },
    onBorrar: c ? async () => !fallo((await sb.from('categorias').delete().eq('id', c.id)).error) : null,
  });
}

function formPassword(recuperando = false) {
  abrirFormulario({
    titulo: recuperando ? 'Elige tu nueva contraseña' : 'Cambiar contraseña',
    campos: [
      { name: 'p1', label: 'Nueva contraseña (mínimo 6 caracteres)', type: 'password', required: true },
      { name: 'p2', label: 'Repite la nueva contraseña', type: 'password', required: true },
    ],
    onGuardar: async d => {
      if (d.p1.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', true); return false; }
      if (d.p1 !== d.p2) { toast('Las dos contraseñas no coinciden', true); return false; }
      const { error } = await sb.auth.updateUser({ password: d.p1 });
      if (error) { toast(traducirError(error.message), true); return false; }
      toast('Contraseña cambiada ✅');
    },
  });
}

function formRegla() {
  abrirFormulario({
    titulo: 'Nueva regla',
    campos: [
      { name: 'patron', label: 'Si el concepto contiene…', required: true, placeholder: 'MERCADONA' },
      { name: 'categoria_id', label: '…ponle la categoría', type: 'select', options: state.categorias.filter(c => c.tipo === 'gasto').map(c => ({ value: c.id, text: `${c.icono} ${c.nombre}` })) },
    ],
    onGuardar: async d => !fallo((await sb.from('reglas').insert({ patron: d.patron.trim().toUpperCase(), categoria_id: Number(d.categoria_id) })).error),
  });
}

// ─────────────────────────── acciones ───────────────────────────
let instalarEvento = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalarEvento = e; });

document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-vista]');
  if (nav && !nav.dataset.accion) { state.filtro = state.filtro === 'revisar' ? 'todos' : state.filtro; return irA(nav.dataset.vista); }

  const cp = e.target.closest('[data-copiar]');
  if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copiar); toast('Copiado'); } catch { toast('No se pudo copiar', true); } return; }

  const el = e.target.closest('[data-accion]'); if (!el) return;
  const id = Number(el.dataset.id);
  switch (el.dataset.accion) {
    case 'ir': irA(el.dataset.vista); break;
    case 'mes': state.mes = sumarMes(state.mes, Number(el.dataset.n)); pintar(); break;
    case 'anio': state.anio += Number(el.dataset.n); pintar(); break;
    case 'trim': {
      const t = state.trim.anio * 4 + state.trim.q + Number(el.dataset.n);
      state.trim = { anio: Math.floor(t / 4), q: t % 4 }; pintar(); break;
    }
    case 'filtro': state.filtro = el.dataset.f; pintar(); break;
    case 'ver-revisar': state.filtro = 'revisar'; irA('movimientos'); break;
    case 'editar-mov': formMovimiento(state.movimientos.find(m => m.id === id)); break;
    case 'nueva-cuenta': formCuenta(); break;
    case 'editar-cuenta': formCuenta(state.cuentas.find(c => c.id === id)); break;
    case 'nueva-inv': formInversion(); break;
    case 'editar-inv': formInversion(state.inversiones.find(i => i.id === id)); break;
    case 'nueva-cat': formCategoria(); break;
    case 'editar-cat': formCategoria(cat(id)); break;
    case 'nueva-regla': formRegla(); break;
    case 'borrar-regla':
      if (!fallo((await sb.from('reglas').delete().eq('id', id)).error)) await recargar(); break;
    case 'probar': {
      const texto = prompt('Texto de la notificación de prueba:', '💳 Nueva compra de 1,00 EUR PRUEBA, ES, realizada con tu tarjeta');
      if (!texto) return;
      const { data, error } = await sb.rpc('registrar_notificacion', { p_token: state.perfil.token_ingesta, p_texto: texto, p_titulo: 'Prueba' });
      if (fallo(error)) return;
      toast(data.resultado === 'creado' ? `✅ ${data.tipo} de ${eur(data.importe)} · ${data.concepto}` : `Resultado: ${data.resultado}`);
      await recargar(); break;
    }
    case 'nuevo-token':
      if (!confirm('Tendrás que actualizar el token en MacroDroid. ¿Continuar?')) return;
      if (!fallo((await sb.rpc('nuevo_token')).error)) { toast('Token cambiado'); await recargar(); } break;
    case 'exportar': exportarCSV(); break;
    case 'password': formPassword(); break;
    case 'instalar': instalarEvento?.prompt(); break;
    case 'salir': await sb.auth.signOut(); location.reload(); break;
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'buscar') {
    state.busqueda = e.target.value;
    const pos = e.target.selectionStart; pintar();
    const b = $('#buscar'); b.focus(); b.setSelectionRange(pos, pos);
  }
});

document.addEventListener('submit', async e => {
  if (e.target.id !== 'form-perfil') return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const { error } = await sb.from('perfil').update({ ingresos_fijos: Number(d.ingresos_fijos), inflacion: Number(d.inflacion) }).eq('user_id', state.user.id);
  if (!fallo(error)) { toast('Guardado'); await recargar(); }
});

$('#fab').onclick = () => formMovimiento();

function exportarCSV() {
  const filas = [['fecha', 'tipo', 'importe', 'categoria', 'concepto', 'notas', 'origen']];
  for (const m of state.movimientos) filas.push([new Date(m.fecha).toLocaleString('es-ES'), m.tipo, String(m.importe).replace('.', ','), cat(m.categoria_id)?.nombre || '', m.concepto, m.descripcion || '', m.origen]);
  const csv = '﻿' + filas.map(f => f.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `mis-cuentas-${claveMes(hoy)}.csv`; a.click();
}

// ─────────────────────────── acceso ───────────────────────────
let modoLogin = 'entrar';
$$('#form-login button').forEach(b => b.addEventListener('click', () => (modoLogin = b.dataset.modo)));
$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const { email, password } = Object.fromEntries(new FormData(e.target));
  const msg = $('#login-msg'); msg.textContent = '…'; msg.className = 'msg';
  const r = modoLogin === 'registro'
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } })
    : await sb.auth.signInWithPassword({ email, password });
  if (r.error) { msg.textContent = traducirError(r.error.message); msg.className = 'msg error'; return; }
  if (modoLogin === 'registro' && !r.data.session) { msg.textContent = '📧 Te hemos enviado un email para confirmar la cuenta. Ábrelo y vuelve aquí.'; return; }
});

// ¿Has olvidado tu contraseña? → email con enlace para elegir una nueva
$('#btn-olvido').addEventListener('click', async () => {
  const email = $('#form-login [name=email]').value.trim();
  const msg = $('#login-msg');
  if (!email) { msg.textContent = 'Escribe primero tu email arriba y vuelve a pulsar.'; msg.className = 'msg error'; return; }
  msg.textContent = '…'; msg.className = 'msg';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) { msg.textContent = traducirError(error.message); msg.className = 'msg error'; return; }
  msg.textContent = '📧 Te hemos enviado un email con un enlace para elegir una contraseña nueva.';
});

function traducirError(m) {
  if (/rate limit|security purposes/i.test(m)) return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
  if (/different from the old/i.test(m)) return 'La contraseña nueva tiene que ser distinta de la anterior.';
  if (/at least 6/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/invalid login/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/not confirmed/i.test(m)) return 'Tienes que confirmar tu email primero (revisa tu correo).';
  if (/already registered/i.test(m)) return 'Ese email ya tiene cuenta. Pulsa «Entrar».';
  return m;
}

let canal = null;
async function alEntrar(session) {
  state.user = session.user;
  $('#pantalla-login').hidden = true; $('#app').hidden = false;
  $('#vista').innerHTML = '<p class="vacio">Cargando…</p>';
  await cargarTodo();
  irA(state.vista);
  // tiempo real: cuando entra una notificación nueva se actualiza solo
  canal?.unsubscribe();
  canal = sb.channel('movs').on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' }, () => recargar()).subscribe();
}

function mostrarLogin() { $('#app').hidden = true; $('#pantalla-login').hidden = false; }

document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) recargar(); });

// ─────────────────────────── arranque ───────────────────────────
if (SUPABASE_KEY.startsWith('PEGA')) {
  document.body.innerHTML = '<div class="login"><div class="login-caja"><h1>Falta configurar</h1><p>Abre <code>config.js</code> y pega tu clave <b>publishable</b> de Supabase.</p></div></div>';
} else {
  sb.auth.onAuthStateChange((evento, session) => {
    // setTimeout: Supabase recomienda no llamar a la base de datos dentro de este callback
    if (session && (!state.user || state.user.id !== session.user.id)) { state.user = session.user; setTimeout(() => alEntrar(session), 0); }
    else if (!session) { state.user = null; mostrarLogin(); }
    // has llegado desde el enlace de «contraseña olvidada»: pedir la nueva
    if (evento === 'PASSWORD_RECOVERY') setTimeout(() => formPassword(true), 1200);
  });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
