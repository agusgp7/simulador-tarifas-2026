// ================================
// Simulador UTE (interno)
// Soporta:
// - escalones (TRS/TGS)
// - doble_horario (TRD)
// - rangos_absolutos (TCB)
// Reactiva Grupo 1 solo donde corresponda
// ================================

let DATA = { tarifas: [] };

// ---------- Formatos ----------
function fmtMoneyUY(n) {
  return new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU" }).format(n);
}
function fmtNumberUY(n, dec = 2) {
  return new Intl.NumberFormat("es-UY", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
function fmtKwh(n) {
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, 3);
}
function fmtPriceKwh(n) { return fmtNumberUY(n, 3); }
function fmtPriceKw(n) { return fmtNumberUY(n, 1); }
function fmtPercent(n) { return fmtNumberUY(n, 2) + "%"; }
function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

// ---------- Energía Escalones ----------
function calcEnergiaEscalones(kwh, escalones) {
  let restante = Math.max(0, kwh);
  const detalle = [];
  let anteriorHasta = 0;
  let idx = 0;

  for (const esc of escalones) {
    if (restante <= 0) break;
    idx++;

    const hasta = esc.hastaIncluye ?? Infinity;
    const maxEnTramo = Math.max(0, hasta - anteriorHasta);
    const kwhEnTramo = Math.min(restante, maxEnTramo);

    if (kwhEnTramo > 0) {
      detalle.push({
        concepto: `${idx}º Escalón ${fmtKwh(kwhEnTramo)} kWh x $ ${fmtPriceKwh(esc.precioPorKWh)}`,
        importe: kwhEnTramo * esc.precioPorKWh
      });
    }

    restante -= kwhEnTramo;
    anteriorHasta = hasta;
  }

  return detalle;
}

// ---------- Energía Rangos Absolutos (TCB) ----------
function calcEnergiaRangosAbsolutos(kwhTotal, rangos) {
  const total = Math.max(0, kwhTotal);
  const detalle = [];
  let idx = 0;

  for (const r of rangos) {
    idx++;
    const desde = r.desdeIncluye;
    const hasta = r.hastaIncluye ?? Infinity;

    const kwhEnRango = Math.max(0, Math.min(total, hasta) - desde + 1);

    if (kwhEnRango > 0) {
      detalle.push({
        concepto: `${idx}º Escalón ${fmtKwh(kwhEnRango)} kWh x $ ${fmtPriceKwh(r.precioPorKWh)}`,
        importe: kwhEnRango * r.precioPorKWh
      });
    }
  }

  return detalle;
}

// ---------- Cálculo ----------
function calcularTarifa(tarifa, inputs) {

  const tasaIva = tarifa.iva?.tasa ?? 0.22;
  const ivaAplica = tarifa.iva?.aplica ?? {};

  const detalleCargo = [];
  const detallePotencia = [];
  let detalleEnergia = [];

  // Cargo fijo / mensual
  if (tarifa.cargoFijo) {
    detalleCargo.push({
      concepto: tarifa.ui?.labelCargoFijo ?? "Cargo fijo mensual",
      importe: tarifa.cargoFijo,
      aplicaIva: ivaAplica.cargoFijo
    });
  }

  // Potencia (solo si existe en la tarifa)
  if (tarifa.potencia && tarifa.potencia.precioPorkW > 0) {
    const kw = num(inputs.kw);
    const importePot = kw * tarifa.potencia.precioPorkW;

    detallePotencia.push({
      concepto: `${fmtNumberUY(kw,1)} kW x $ ${fmtPriceKw(tarifa.potencia.precioPorkW)}`,
      importe: importePot,
      aplicaIva: ivaAplica.potencia
    });
  }

  // Energía
  const energia = tarifa.energia;
  const kwh = num(inputs.kwhTotal);

  if (energia.tipo === "escalones") {
    detalleEnergia = calcEnergiaEscalones(kwh, energia.escalones)
      .map(r => ({ ...r, aplicaIva: ivaAplica.energia }));
  }

  if (energia.tipo === "rangos_absolutos") {
    detalleEnergia = calcEnergiaRangosAbsolutos(kwh, energia.rangos)
      .map(r => ({ ...r, aplicaIva: ivaAplica.energia }));
  }

  // Totales
  const todos = [...detalleCargo, ...detallePotencia, ...detalleEnergia];

  const gravado = todos.filter(r => r.aplicaIva).reduce((a,b)=>a+b.importe,0);
  const noGravado = todos.filter(r => !r.aplicaIva).reduce((a,b)=>a+b.importe,0);

  const iva = gravado * tasaIva;
  const total = gravado + noGravado + iva;

  return { detalleCargo, detallePotencia, detalleEnergia, gravado, noGravado, iva, total };
}

// ---------- UI ----------
const tarifaSelect = document.getElementById("tarifaSelect");
const kwInput = document.getElementById("kwInput");
const energyInputs = document.getElementById("energyInputs");
const calcBtn = document.getElementById("calcBtn");
const resultCard = document.getElementById("resultCard");
const detalleBody = document.getElementById("detalleBody");
const totalOut = document.getElementById("totalOut");
const notaTarifa = document.getElementById("notaTarifa");

function renderInputs(tarifa){

  // Ocultar potencia si no corresponde
  const kwLabel = kwInput.parentElement.parentElement;
  if (!tarifa.potencia || tarifa.potencia.precioPorkW === 0){
    kwLabel.style.display = "none";
  } else {
    kwLabel.style.display = "grid";
  }

  if (tarifa.energia.tipo === "escalones" || tarifa.energia.tipo === "rangos_absolutos"){
    energyInputs.innerHTML = `
      <label>Consumo mensual (kWh)</label>
      <input id="kwhTotal" type="number" min="0" step="0.01" value="0" />
    `;
  }
}

function renderResultado(res, tarifa){
  detalleBody.innerHTML = "";

  if (res.detalleCargo.length){
    detalleBody.innerHTML += `<tr class="section-row"><td colspan="2"><b>${tarifa.ui?.tituloCargoFijo ?? "CARGO FIJO"}</b></td></tr>`;
    res.detalleCargo.forEach(r=>detalleBody.innerHTML+=`<tr><td>${r.concepto}</td><td class="right">${fmtMoneyUY(r.importe)}</td></tr>`);
  }

  if (res.detallePotencia.length){
    detalleBody.innerHTML += `<tr class="section-row"><td colspan="2"><b>CARGO POTENCIA CONTRATADA</b></td></tr>`;
    res.detallePotencia.forEach(r=>detalleBody.innerHTML+=`<tr><td>${r.concepto}</td><td class="right">${fmtMoneyUY(r.importe)}</td></tr>`);
  }

  detalleBody.innerHTML += `<tr class="section-row"><td colspan="2"><b>CARGO ENERGIA MENSUAL</b></td></tr>`;
  res.detalleEnergia.forEach(r=>detalleBody.innerHTML+=`<tr><td>${r.concepto}</td><td class="right">${fmtMoneyUY(r.importe)}</td></tr>`);

  detalleBody.innerHTML += `<tr class="section-row"><td colspan="2"><b>SUBTOTALES</b></td></tr>`;
  detalleBody.innerHTML += `<tr><td>Importe No Gravado</td><td class="right">${fmtMoneyUY(res.noGravado)}</td></tr>`;
  detalleBody.innerHTML += `<tr><td>Importe Gravado 22%</td><td class="right">${fmtMoneyUY(res.gravado)}</td></tr>`;
  detalleBody.innerHTML += `<tr><td>IVA Tasa Básica 22%</td><td class="right">${fmtMoneyUY(res.iva)}</td></tr>`;

  totalOut.textContent = fmtMoneyUY(res.total);
  notaTarifa.textContent = tarifa.notas ?? "";
  resultCard.style.display = "block";
}

calcBtn.addEventListener("click", ()=>{
  const tarifa = DATA.tarifas.find(t=>t.id===tarifaSelect.value);
  const inputs = {
    kw: kwInput.value,
    kwhTotal: document.getElementById("kwhTotal")?.value
  };
  const res = calcularTarifa(tarifa, inputs);
  renderResultado(res, tarifa);
});

tarifaSelect.addEventListener("change", ()=>{
  const tarifa = DATA.tarifas.find(t=>t.id===tarifaSelect.value);
  renderInputs(tarifa);
  resultCard.style.display = "none";
});

fetch("./tarifas.json",{cache:"no-store"})
.then(r=>r.json())
.then(json=>{
  DATA=json;
  DATA.tarifas.forEach(t=>{
    const opt=document.createElement("option");
    opt.value=t.id;
    opt.textContent=t.nombre;
    tarifaSelect.appendChild(opt);
  });
  renderInputs(DATA.tarifas[0]);
});
