// ================================
// Simulador UTE (interno) - app.js
// Soporta:
// - escalones (TRS/TGS)
// - doble_horario (TRD)
// - rangos_absolutos (TCB)
// Reactiva Grupo 1 (k1/k1 adicional) solo donde corresponda (NO en TCB)
// ================================

let DATA = { tarifas: [] };

// ---------- Formatos ----------
function fmtMoneyUY(n) {
  return new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU" }).format(n);
}
function fmtNumberUY(n, dec = 2) {
  return new Intl.NumberFormat("es-UY", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
function fmtKwh(n, decIfNotInt = 3) {
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, decIfNotInt);
}
function fmtKw(n) {
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, 1);
}
function fmtPriceKwh(n) { return fmtNumberUY(n, 3); }
function fmtPriceKw(n) { return fmtNumberUY(n, 1); }
function fmtPercent(n) { return fmtNumberUY(n, 2) + "%"; }
function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}
function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---------- Energía por escalones (acumulado) ----------
function calcEnergiaEscalones(kwh, escalones) {
  let restante = Math.max(0, kwh);
  const detalle = [];
  let anteriorHasta = 0;
  let idx = 0;

  for (const esc of escalones) {
    if (restante <= 0) break;
    idx++;

    const hasta = esc.hastaIncluye; // number o null
    const tope = (hasta === null) ? Infinity : Number(hasta);

    const maxEnTramo = (tope === Infinity) ? Infinity : Math.max(0, tope - anteriorHasta);
    const kwhEnTramo = Math.min(restante, maxEnTramo);

    if (kwhEnTramo > 0) {
      const nombreEscalon =
        idx === 1 ? "1er Escalón" :
        idx === 2 ? "2do Escalón" :
        idx === 3 ? "3er Escalón" :
        `${idx}º Escalón`;

      detalle.push({
        concepto: `${nombreEscalon} ${fmtKwh(kwhEnTramo)} kWh x $ ${fmtPriceKwh(esc.precioPorKWh)}`,
        importe: kwhEnTramo * esc.precioPorKWh
      });
    }

    restante -= kwhEnTramo;
    anteriorHasta = (tope === Infinity) ? anteriorHasta : tope;
  }

  return detalle;
}

// ---------- Energía por rangos absolutos (TCB: 101-140, etc.) ----------
function calcEnergiaRangosAbsolutos(kwhTotal, rangos) {
  const total = Math.max(0, kwhTotal);
  const detalle = [];
  let idx = 0;

  for (const r of rangos) {
    idx++;
    const desde = Number(r.desdeIncluye);
    const hasta = (r.hastaIncluye === null) ? Infinity : Number(r.hastaIncluye);

    // kWh dentro del rango para ese total mensual (incluyendo extremos)
    const kwhEnRango = Math.max(0, Math.min(total, hasta) - desde + 1);
    if (kwhEnRango <= 0) continue;

    const nombreEscalon =
      idx === 1 ? "1er Escalón" :
      idx === 2 ? "2do Escalón" :
      idx === 3 ? "3er Escalón" :
      `${idx}º Escalón`;

    detalle.push({
      concepto: `${nombreEscalon} ${fmtKwh(kwhEnRango)} kWh x $ ${fmtPriceKwh(r.precioPorKWh)}`,
      importe: kwhEnRango * r.precioPorKWh
    });
  }

  return detalle;
}

// ---------- Energía doble horario (TRD) ----------
function calcEnergiaDobleHorario(kwhPunta, precioPunta, kwhFuera, precioFuera) {
  const kp = Math.max(0, kwhPunta);
  const kf = Math.max(0, kwhFuera);

  return [
    { concepto: `Punta ${fmtKwh(kp, 2)} kWh x $ ${fmtPriceKwh(precioPunta)}`, importe: kp * precioPunta },
    { concepto: `Fuera de Punta ${fmtKwh(kf, 2)} kWh x $ ${fmtPriceKwh(precioFuera)}`, importe: kf * precioFuera }
  ];
}

// ---------- Reactiva Grupo 1 (k1/k1adicional) ----------
function calcReactivaGrupo1(eaKwh, erKvarh, energiaActivaImporteSinIva) {
  const ea = Math.max(0, eaKwh);
  const er = Math.max(0, erKvarh);
  if (ea <= 0 || er <= 0) return { coefTotal: 0, cargo: 0 };

  const ratio = er / ea;

  let k1 = 0;
  let k1ad = 0;

  if (ratio > 0.426) k1 = 0.4 * (ratio - 0.426);
  if (ratio > 0.7) k1ad = 0.6 * (ratio - 0.7);

  const coefTotal = k1 + k1ad;
  const cargo = coefTotal * Math.max(0, energiaActivaImporteSinIva);

  return { coefTotal, cargo };
}

// ---------- Cálculo general ----------
function calcularTarifa(tarifa, inputs) {
  const tasaIva = num(tarifa.iva?.tasa ?? 0.22);
  const aplica = tarifa.iva?.aplica ?? {};

  const ui = tarifa.ui || {};
  const tituloCargoFijo = ui.tituloCargoFijo || "CARGO FIJO";
  const labelCargoFijo = ui.labelCargoFijo || "Cargo fijo mensual";

  // Cargo fijo / mensual
  const detalleCargo = [];
  if (Number.isFinite(Number(tarifa.cargoFijo)) && num(tarifa.cargoFijo) !== 0) {
    detalleCargo.push({
      concepto: labelCargoFijo,
      importe: num(tarifa.cargoFijo),
      aplicaIva: !!aplica.cargoFijo,
      __titulo: tituloCargoFijo
    });
  }

  // Potencia (solo si la tarifa tiene bloque potencia)
  const detallePotencia = [];
  if (tarifa.potencia && Number.isFinite(Number(tarifa.potencia.precioPorkW)) && num(tarifa.potencia.precioPorkW) > 0) {
    const kw = Math.max(0, num(inputs.kw));
    const precio = num(tarifa.potencia.precioPorkW);
    const imp = kw * precio;

    detallePotencia.push({
      concepto: `${fmtKw(kw)} kW x $ ${fmtPriceKw(precio)}`,
      importe: imp,
      aplicaIva: !!aplica.potencia
    });
  }

  // Energía
  const energia = tarifa.energia || {};
  let detalleEnergia = [];

  let eaKwhTotal = 0;
  let energiaActivaImporteSinIva = 0;

  if (energia.tipo === "escalones") {
    const kwh = Math.max(0, num(inputs.kwhTotal));
    eaKwhTotal = kwh;

    const det = calcEnergiaEscalones(kwh, energia.escalones || []);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);

    detalleEnergia = det.map(r => ({ ...r, aplicaIva: !!aplica.energia }));
  } else if (energia.tipo === "doble_horario") {
    const kwhPunta = Math.max(0, num(inputs.kwhPunta));
    const kwhFuera = Math.max(0, num(inputs.kwhFueraPunta));
    eaKwhTotal = kwhPunta + kwhFuera;

    const precioP = num(energia.punta?.precioPorKWh);
    const precioF = num(energia.fueraPunta?.precioPorKWh);

    const det = calcEnergiaDobleHorario(kwhPunta, precioP, kwhFuera, precioF);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);

    detalleEnergia = det.map(r => ({ ...r, aplicaIva: !!aplica.energia }));
  } else if (energia.tipo === "rangos_absolutos") {
    const kwh = Math.max(0, num(inputs.kwhTotal));
    eaKwhTotal = kwh;

    const det = calcEnergiaRangosAbsolutos(kwh, energia.rangos || []);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);

    detalleEnergia = det.map(r => ({ ...r, aplicaIva: !!aplica.energia }));
  } else {
    throw new Error("Tipo de energía no soportado: " + (energia.tipo ?? "desconocido"));
  }

  // Reactiva: solo si la tarifa lo tiene y no es TCB (vos pediste que no aparezca en TCB)
  const reactivaCfg = tarifa.reactiva;
  const showReactivaUI = (tarifa.id !== "TCB") && (reactivaCfg?.modelo === "grupo1_k1");
  if (showReactivaUI && !!inputs.calculaReactiva) {
    const er = Math.max(0, num(inputs.kvarh));
    const rr = calcReactivaGrupo1(eaKwhTotal, er, energiaActivaImporteSinIva);

    const pct = rr.coefTotal * 100;
    const cargo = round2(rr.cargo);

    if (cargo > 0) {
      detalleEnergia.push({
        concepto: `Energía Reactiva ${fmtPercent(pct)} x ${fmtMoneyUY(energiaActivaImporteSinIva)}`,
        importe: cargo,
        aplicaIva: !!aplica.reactiva
      });
    }
  }

  // Totales
  const todos = [...detalleCargo, ...detallePotencia, ...detalleEnergia];
  const gravado = todos.filter(r => r.aplicaIva).reduce((a, r) => a + r.importe, 0);
  const noGravado = todos.filter(r => !r.aplicaIva).reduce((a, r) => a + r.importe, 0);

  const iva = gravado * tasaIva;
  const total = gravado + noGravado + iva;

  return {
    detalleCargo,
    detallePotencia,
    detalleEnergia,
    gravado,
    noGravado,
    iva,
    total,
    __tituloCargoFijo: tituloCargoFijo
  };
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

// Encontrar el contenedor "card" del input de potencia para ocultarlo cuando no aplica
function getKwBlock() {
  // kwInput está dentro de: div.row -> div (col) -> input
  // Queremos ocultar el "div" contenedor de esa col
  return kwInput?.parentElement; // el <div> que contiene label+input
}

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

function renderResultado(res, tarifa) {
  detalleBody.innerHTML = "";

  if (res.detalleCargo.length) {
    addSection(res.__tituloCargoFijo || "CARGO FIJO");
    res.detalleCargo.forEach(r => addRow(r.concepto, r.importe));
  }

  if (res.detallePotencia.length) {
    addSection("CARGO POTENCIA CONTRATADA");
    res.detallePotencia.forEach(r => addRow(r.concepto, r.importe));
  }

  addSection("CARGO ENERGIA MENSUAL");
  res.detalleEnergia.forEach(r => addRow(r.concepto, r.importe));

  addSection("SUBTOTALES");
  addRow("Importe No Gravado", res.noGravado);
  addRow("Importe Gravado 22%", res.gravado);
  addRow("IVA Tasa Básica 22%", res.iva);

  totalOut.textContent = fmtMoneyUY(res.total);
  notaTarifa.textContent = tarifa.notas || "";
  resultCard.style.display = "block";
}

function showWarn(msg) {
  if (!warnBox) return;
  if (!msg) {
    warnBox.style.display = "none";
    warnBox.textContent = "";
    return;
  }
  warnBox.style.display = "block";
  warnBox.textContent = msg;
}

function validateTarifaInputs(tarifa, kw) {
  if (tarifa.id === "TRD") {
    if (kw > 0 && kw < 3.5) return "TRD aplica para potencia contratada >= 3,5 kW.";
    if (kw > 40) return "TRD aplica hasta 40 kW.";
  }
  if (tarifa.id === "TRS" || tarifa.id === "TGS") {
    if (kw > 40) return `${tarifa.id} aplica hasta 40 kW.`;
  }
  if (tarifa.id === "TCB") {
    // No se ingresa potencia, pero si está visible por algún motivo, avisamos
    if (kw > 0) return "TCB: no se ingresa potencia contratada en este simulador.";
  }
  return "";
}

function renderInputsForTarifa(tarifa) {
  // Potencia visible solo si la tarifa tiene bloque potencia válido
  const kwBlock = getKwBlock();
  const potenciaAplica = tarifa.potencia && Number.isFinite(Number(tarifa.potencia.precioPorkW)) && num(tarifa.potencia.precioPorkW) > 0;

  if (kwBlock) {
    kwBlock.style.display = potenciaAplica ? "block" : "none";
  }

  // Inputs de energía según tipo
  const tipo = tarifa.energia?.tipo;

  // Reactiva: SOLO grupo1 y NO TCB
  const showReactiva = (tarifa.id !== "TCB") && (tarifa.reactiva?.modelo === "grupo1_k1");

  const reactivaBlock = showReactiva ? `
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
    </div>
  ` : "";

  if (tipo === "doble_horario") {
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
      ${reactivaBlock}
    `;
  } else if (tipo === "escalones" || tipo === "rangos_absolutos") {
    energyInputs.innerHTML = `
      <div class="row">
        <div>
          <label>Consumo mensual (kWh)</label>
          <input id="kwhTotal" type="number" min="0" step="0.01" value="0" />
        </div>
        <div></div>
      </div>
      ${reactivaBlock}
    `;
  } else {
    energyInputs.innerHTML = `<div class="muted">Esta tarifa aún no tiene inputs implementados.</div>`;
  }

  // Hook reactiva toggle
  const chk = document.getElementById("calculaReactiva");
  const rbox = document.getElementById("reactivaInputs");
  if (chk && rbox) {
    const sync = () => { rbox.style.display = chk.checked ? "block" : "none"; };
    chk.addEventListener("change", () => { sync(); resultCard.style.display = "none"; });
    sync();
  }

  // Warning
  showWarn(validateTarifaInputs(tarifa, num(kwInput.value)));
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

function getTarifaActual() {
  return DATA.tarifas.find(t => t.id === tarifaSelect.value);
}

tarifaSelect.addEventListener("change", () => {
  const tarifa = getTarifaActual();
  renderInputsForTarifa(tarifa);
  resultCard.style.display = "none";
});

kwInput.addEventListener("input", () => {
  const tarifa = getTarifaActual();
  if (!tarifa) return;
  showWarn(validateTarifaInputs(tarifa, num(kwInput.value)));
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
  renderResultado(res, tarifa);
});

// ---------- Cargar tarifas.json ----------
fetch("./tarifas.json", { cache: "no-store" })
  .then(r => r.json())
  .then(json => {
    DATA = json;
    fillTarifas();
    const tarifa = getTarifaActual();
    renderInputsForTarifa(tarifa);
  })
  .catch(err => {
    console.error(err);
    alert("No se pudo cargar tarifas.json");
  });
