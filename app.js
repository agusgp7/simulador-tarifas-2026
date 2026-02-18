// ================================
// Simulador UTE (interno)
// - Lee tarifas desde tarifas.json
// - Soporta: escalones (TRS) y doble_horario (TRD)
// - Reactiva Grupo 1 (TRS/TGS/TCB a futuro): recargo k1 sobre importe energía activa (sin IVA)
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
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, 2);
}
function fmtKw(n) {
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, 1);
}
function fmtPriceKwh(n) { return fmtNumberUY(n, 3); }
function fmtPriceKw(n) { return fmtNumberUY(n, 1); }
function fmtPercent(n) { return fmtNumberUY(n, 2) + "%"; } // n ya viene en %
function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

// ---------- Energía por escalones ----------
function calcEnergiaEscalones(kwh, escalones) {
  let restante = Math.max(0, kwh);
  const detalle = [];
  let anteriorHasta = 0;
  let idx = 0;

  for (const esc of escalones) {
    if (restante <= 0) break;
    idx++;

    const hasta = esc.hastaIncluye; // number o null
    const topeActual = (hasta === null) ? Infinity : hasta;

    const maxEnTramo = (topeActual === Infinity)
      ? Infinity
      : Math.max(0, topeActual - anteriorHasta);

    const kwhEnTramo = Math.min(restante, maxEnTramo);
    const costoTramo = kwhEnTramo * esc.precioPorKWh;

    const nombreEscalon =
      idx === 1 ? "1er Escalón" :
      idx === 2 ? "2do Escalón" :
      idx === 3 ? "3er Escalón" :
      `${idx}º Escalón`;

    detalle.push({
      concepto: `${nombreEscalon} ${fmtKwh(kwhEnTramo)} kWh x $ ${fmtPriceKwh(esc.precioPorKWh)}`,
      importe: costoTramo
    });

    restante -= kwhEnTramo;
    anteriorHasta = (topeActual === Infinity) ? anteriorHasta : topeActual;
  }

  return detalle;
}

// ---------- Energía doble horario (TRD) ----------
function calcEnergiaDobleHorario(kwhPunta, precioPunta, kwhFuera, precioFuera) {
  const kp = Math.max(0, kwhPunta);
  const kf = Math.max(0, kwhFuera);

  return [
    { concepto: `Punta ${fmtKwh(kp)} kWh x $ ${fmtPriceKwh(precioPunta)}`, importe: kp * precioPunta },
    { concepto: `Fuera de Punta ${fmtKwh(kf)} kWh x $ ${fmtPriceKwh(precioFuera)}`, importe: kf * precioFuera }
  ];
}

// ---------- Reactiva Grupo 1 (k1 / k1 adicional) ----------
function calcReactivaGrupo1(eaKwh, erKvarh, energiaActivaImporteSinIva) {
  const ea = Math.max(0, eaKwh);
  const er = Math.max(0, erKvarh);

  if (ea <= 0 || er <= 0) {
    return { coefTotal: 0, k1: 0, k1ad: 0, ratio: 0, cargo: 0 };
    // si no hay activa o reactiva, no cobramos
  }

  const ratio = er / ea; // er/ea

  let k1 = 0;
  let k1ad = 0;

  if (ratio > 0.426) {
    k1 = 0.4 * (ratio - 0.426);
  }
  if (ratio > 0.7) {
    k1ad = 0.6 * (ratio - 0.7);
  }

  const coefTotal = k1 + k1ad;
  const cargo = coefTotal * Math.max(0, energiaActivaImporteSinIva);

  return { coefTotal, k1, k1ad, ratio, cargo };
}

// ---------- Cálculo general ----------
function calcularTarifa(tarifa, inputs) {
  const kwSafe = Math.max(0, num(inputs.kw));

  const tasaIva = num(tarifa.iva?.tasa ?? 0.22);

  const cargoFijo = num(tarifa.cargoFijo);
  const potenciaPrecio = num(tarifa.potencia?.precioPorkW);
  const potencia = kwSafe * potenciaPrecio;

  const ivaAplicaCargoFijo = !!tarifa.iva?.aplica?.cargoFijo; // false
  const ivaAplicaPotencia  = !!tarifa.iva?.aplica?.potencia;  // true
  const ivaAplicaEnergia   = !!tarifa.iva?.aplica?.energia;   // true
  const ivaAplicaReactiva  = !!tarifa.iva?.aplica?.reactiva;  // true

  const detalleCargoFijo = [
    { concepto: "Cargo fijo mensual", importe: cargoFijo, aplicaIva: ivaAplicaCargoFijo }
  ];

  const detallePotencia = [
    { concepto: `${fmtKw(kwSafe)} kW x $ ${fmtPriceKw(potenciaPrecio)}`, importe: potencia, aplicaIva: ivaAplicaPotencia }
  ];

  let detalleEnergia = [];
  const energia = tarifa.energia || {};

  // Importante: necesitamos el importe de energía activa (sin IVA) para la reactiva grupo 1
  let eaKwhTotal = 0;
  let energiaActivaImporteSinIva = 0;

  if (energia.tipo === "escalones") {
    const kwhTotal = Math.max(0, num(inputs.kwhTotal));
    eaKwhTotal = kwhTotal;

    const det = calcEnergiaEscalones(kwhTotal, energia.escalones);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);

    detalleEnergia = det.map(d => ({ ...d, aplicaIva: ivaAplicaEnergia }));

  } else if (energia.tipo === "doble_horario") {
    const kwhPunta = Math.max(0, num(inputs.kwhPunta));
    const kwhFuera = Math.max(0, num(inputs.kwhFueraPunta));
    eaKwhTotal = kwhPunta + kwhFuera;

    const precioP = num(energia.punta?.precioPorKWh);
    const precioF = num(energia.fueraPunta?.precioPorKWh);

    const det = calcEnergiaDobleHorario(kwhPunta, precioP, kwhFuera, precioF);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);

    detalleEnergia = det.map(d => ({ ...d, aplicaIva: ivaAplicaEnergia }));
  } else {
    throw new Error("Tipo de energía no soportado aún: " + (energia.tipo ?? "desconocido"));
  }

  // ----- Reactiva (solo si la tarifa tiene modelo y el usuario habilitó cálculo) -----
  const reactivaCfg = tarifa.reactiva;
  const calculaReactiva = !!inputs.calculaReactiva;

  if (reactivaCfg?.modelo === "grupo1_k1" && calculaReactiva) {
    const er = Math.max(0, num(inputs.kvarh));
    const resR = calcReactivaGrupo1(eaKwhTotal, er, energiaActivaImporteSinIva);

    const pct = resR.coefTotal * 100; // porcentaje
    // Redondeo de cargo a 2 decimales como pediste
    const cargoRounded = Math.round((resR.cargo + Number.EPSILON) * 100) / 100;

    // Solo mostramos si hay algo para cobrar (>0, aunque podría ser 0)
    if (cargoRounded > 0) {
      detalleEnergia.push({
        concepto: `Energía Reactiva ${fmtPercent(pct)} x ${fmtMoneyUY(energiaActivaImporteSinIva)}`,
        importe: cargoRounded,
        aplicaIva: ivaAplicaReactiva
      });
    } else {
      // Si querés que muestre igualmente "Energía Reactiva 0%" lo activamos después.
    }
  }

  // Totales
  const itemsAll = [...detalleCargoFijo, ...detallePotencia, ...detalleEnergia];
  const importeGravado = itemsAll.filter(r => r.aplicaIva).reduce((a, r) => a + r.importe, 0);
  const importeNoGravado = itemsAll.filter(r => !r.aplicaIva).reduce((a, r) => a + r.importe, 0);

  const iva = importeGravado * tasaIva;
  const total = importeNoGravado + importeGravado + iva;

  return { detalleCargoFijo, detallePotencia, detalleEnergia, importeNoGravado, importeGravado, iva, total };
}

// ---------- UI ----------
const tarifaSelect = document.getElementById("tarifaSelect");
const kwInput = document.getElementById("kwInput");
const energyInputs = document.getElementById("energyInputs");
const warnBox = document.getElementById("warnBox");

const calcBtn = document.getElementById("calcBtn");
const resultCard = document.getElementById("resultCard");
const detalleBody = document.getElementById("detalleBody");
const totalOut = document.getElementById("totalOut");
const notaTarifa = document.getElementById("notaTarifa");

function addSection(title) {
  const tr = document.createElement("tr");
  tr.className = "section-row";
  tr.innerHTML = `<td colspan="2"><b>${title}</b></td>`;
  detalleBody.appendChild(tr);
}
function addRow(concepto, importe) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${concepto}</td><td class="right">${fmtMoneyUY(importe)}</td>`;
  detalleBody.appendChild(tr);
}

function render(res, tarifa) {
  detalleBody.innerHTML = "";

  addSection("CARGO FIJO");
  res.detalleCargoFijo.forEach(r => addRow(r.concepto, r.importe));

  addSection("CARGO POTENCIA CONTRATADA");
  res.detallePotencia.forEach(r => addRow(r.concepto, r.importe));

  addSection("CARGO ENERGIA MENSUAL");
  res.detalleEnergia.forEach(r => addRow(r.concepto, r.importe));

  addSection("SUBTOTALES");
  addRow("Importe No Gravado", res.importeNoGravado);
  addRow("Importe Gravado 22%", res.importeGravado);
  addRow("IVA", res.iva);

  totalOut.textContent = fmtMoneyUY(res.total);
  notaTarifa.textContent = tarifa.notas || "";
  resultCard.style.display = "block";
}

function getTarifaActual() {
  return DATA.tarifas.find(t => t.id === tarifaSelect.value);
}

function showWarn(msg) {
  if (!msg) {
    warnBox.style.display = "none";
    warnBox.textContent = "";
    return;
  }
  warnBox.style.display = "block";
  warnBox.textContent = msg;
}

function renderEnergyInputsForTarifa(tarifa) {
  const tipo = tarifa.energia?.tipo;
  const reactivaModelo = tarifa.reactiva?.modelo;

  // bloque reactiva grupo1
  const reactivaBlockGrupo1 = (reactivaModelo === "grupo1_k1") ? `
    <div class="inline">
      <input id="calculaReactiva" type="checkbox" ${tarifa.reactiva?.defaultCalcula ? "checked" : ""} />
      <label for="calculaReactiva" style="margin:0;">Calcula Reactiva</label>
    </div>
    <div id="reactivaInputs" style="display:none;">
      <div class="row">
        <div>
          <label>Energía reactiva (kVArh)</label>
          <input id="kvarh" type="number" min="0" step="0.01" value="0" />
        </div>
        <div></div>
      </div>
      <div class="muted">Grupo 1: recargo k1 sobre importe de energía activa (sin IVA).</div>
    </div>
  ` : "";

  if (tipo === "escalones") {
    energyInputs.innerHTML = `
      <div class="row">
        <div>
          <label>Consumo mensual (kWh)</label>
          <input id="kwhTotal" type="number" min="0" step="0.01" value="0" />
        </div>
        <div></div>
      </div>
      ${reactivaBlockGrupo1}
    `;
  } else if (tipo === "doble_horario") {
    energyInputs.innerHTML = `
      <div class="row">
        <div>
          <label>Consumo mensual Punta (kWh)</label>
          <input id="kwhPunta" type="number" min="0" step="0.01" value="0" />
        </div>
        <div>
          <label>Consumo mensual Fuera de Punta (kWh)</label>
          <input id="kwhFueraPunta" type="number" min="0" step="0.01" value="0" />
        </div>
      </div>
      ${reactivaBlockGrupo1}
    `;
  } else {
    energyInputs.innerHTML = `<div class="muted">Esta tarifa aún no tiene inputs implementados.</div>`;
  }

  // Hook checkbox reactiva (si existe)
  const chk = document.getElementById("calculaReactiva");
  const rbox = document.getElementById("reactivaInputs");
  if (chk && rbox) {
    const sync = () => { rbox.style.display = chk.checked ? "block" : "none"; };
    chk.addEventListener("change", () => { sync(); resultCard.style.display = "none"; });
    sync();
  }
}

function validateTarifaInputs(tarifa, kw) {
  if (tarifa.id === "TRD") {
    if (kw > 0 && kw < 3.5) return "TRD aplica para potencia contratada >= 3,5 kW.";
    if (kw > 40) return "TRD aplica hasta 40 kW.";
  }
  if (tarifa.id === "residencial_simple") {
    if (kw > 40) return "TRS aplica hasta 40 kW.";
  }
  return "";
}

function fillTarifas() {
  tarifaSelect.innerHTML = "";
  DATA.tarifas.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.nombre;
    tarifaSelect.appendChild(opt);
  });
}

tarifaSelect.addEventListener("change", () => {
  const t = getTarifaActual();
  renderEnergyInputsForTarifa(t);
  showWarn(validateTarifaInputs(t, num(kwInput.value)));
  resultCard.style.display = "none";
});

kwInput.addEventListener("input", () => {
  const t = getTarifaActual();
  if (!t) return;
  showWarn(validateTarifaInputs(t, num(kwInput.value)));
});

calcBtn.addEventListener("click", () => {
  const tarifa = getTarifaActual();
  if (!tarifa) return;

  const inputs = {
    kw: kwInput.value,
    kwhTotal: document.getElementById("kwhTotal")?.value,
    kwhPunta: document.getElementById("kwhPunta")?.value,
    kwhFueraPunta: document.getElementById("kwhFueraPunta")?.value,
    calculaReactiva: document.getElementById("calculaReactiva")?.checked ?? false,
    kvarh: document.getElementById("kvarh")?.value
  };

  const res = calcularTarifa(tarifa, inputs);
  render(res, tarifa);
});

// ---------- Cargar tarifas.json ----------
fetch("./tarifas.json", { cache: "no-store" })
  .then(r => r.json())
  .then(json => {
    DATA = json;
    fillTarifas();

    const t = getTarifaActual();
    renderEnergyInputsForTarifa(t);
    showWarn(validateTarifaInputs(t, num(kwInput.value)));
  })
  .catch(err => {
    console.error(err);
    alert("No se pudo cargar tarifas.json");
  });
