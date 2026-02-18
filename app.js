// ================================
// Simulador UTE (interno)
// Soporta: escalones (TRS/TGS), doble_horario (TRD), rangos_absolutos (TCB)
// Reactiva Grupo 1 (k1/k1 adicional) con checkbox "Calcula Reactiva"
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
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, 3); // 3 decimales como tu ejemplo 40,000
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

// ---------- Energía por escalones (hastaIncluye acumulado) ----------
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

// ---------- Energía por rangos absolutos (TCB: 101-140, 141-350, 351+) ----------
function calcEnergiaRangosAbsolutos(kwhTotal, rangos) {
  const total = Math.max(0, kwhTotal);
  const detalle = [];
  let idx = 0;

  for (const r of rangos) {
    idx++;

    const desde = Number(r.desdeIncluye);
    const hasta = (r.hastaIncluye === null) ? Infinity : Number(r.hastaIncluye);

    // kWh dentro del rango para ese total mensual
    // Ej: total=157, rango 101-140 => min(157,140)-101+1 = 40
    const kwhEnRango = Math.max(0, Math.min(total, hasta) - desde + 1);

    if (kwhEnRango <= 0) continue;

    const costo = kwhEnRango * r.precioPorKWh;

    const nombreEscalon =
      idx === 1 ? "1er Escalón" :
      idx === 2 ? "2do Escalón" :
      idx === 3 ? "3er Escalón" :
      `${idx}º Escalón`;

    detalle.push({
      concepto: `${nombreEscalon} ${fmtKwh(kwhEnRango)} kWh x $ ${fmtPriceKwh(r.precioPorKWh)}`,
      importe: costo
    });
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

// ---------- Reactiva Grupo 1 ----------
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
  const kwSafe = Math.max(0, num(inputs.kw));
  const tasaIva = num(tarifa.iva?.tasa ?? 0.22);

  const ui = tarifa.ui || {};
  const tituloCargoFijo = ui.tituloCargoFijo || "CARGO FIJO";
  const labelCargoFijo = ui.labelCargoFijo || "Cargo fijo mensual";

  const ivaAplicaCargoFijo = !!tarifa.iva?.aplica?.cargoFijo;
  const ivaAplicaPotencia  = !!tarifa.iva?.aplica?.potencia;
  const ivaAplicaEnergia   = !!tarifa.iva?.aplica?.energia;
  const ivaAplicaReactiva  = !!tarifa.iva?.aplica?.reactiva;

  // Cargo fijo / mensual
  const cargoFijo = num(tarifa.cargoFijo);
  const detalleCargoFijo = [
    { concepto: labelCargoFijo, importe: cargoFijo, aplicaIva: ivaAplicaCargoFijo, __titulo: tituloCargoFijo }
  ];

  // Potencia (puede no existir para TCB)
  let detallePotencia = [];
  if (tarifa.potencia && Number.isFinite(Number(tarifa.potencia.precioPorkW)) && tarifa.potencia.precioPorkW > 0) {
    const potenciaPrecio = num(tarifa.potencia.precioPorkW);
    const potencia = kwSafe * potenciaPrecio;
    detallePotencia = [
      { concepto: `${fmtKw(kwSafe)} kW x $ ${fmtPriceKw(potenciaPrecio)}`, importe: potencia, aplicaIva: ivaAplicaPotencia }
    ];
  }

  // Energía
  let detalleEnergia = [];
  const energia = tarifa.energia || {};
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

  } else if (energia.tipo === "rangos_absolutos") {
    const kwhTotal = Math.max(0, num(inputs.kwhTotal));
    eaKwhTotal = kwhTotal;

    const det = calcEnergiaRangosAbsolutos(kwhTotal, energia.rangos);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);
    detalleEnergia = det.map(d => ({ ...d, aplicaIva: ivaAplicaEnergia }));

  } else {
    throw new Error("Tipo de energía no soportado aún: " + (energia.tipo ?? "desconocido"));
  }

  // Reactiva grupo 1 (si está habilitada)
  const reactivaCfg = tarifa.reactiva;
  const calculaReactiva = !!inputs.calculaReactiva;

  if (reactivaCfg?.modelo === "grupo1_k1" && calculaReactiva) {
    const er = Math.max(0, num(inputs.kvarh));
    const rr = calcReactivaGrupo1(eaKwhTotal, er, energiaActivaImporteSinIva);
    const pct = rr.coefTotal * 100;

    const cargoRounded = Math.round((rr.cargo + Number.EPSILON) * 100) / 100;

    if (cargoRounded > 0) {
      detalleEnergia.push({
        concepto: `Energía Reactiva ${fmtPercent(pct)} x ${fmtMoneyUY(energiaActivaImporteSinIva)}`,
        importe: cargoRounded,
        aplicaIva: ivaAplicaReactiva
      });
    }
  }

  // Totales
  const itemsAll = [...detalleCargoFijo, ...detallePotencia, ...detalleEnergia];
  const importeGravado = itemsAll.filter(r => r.aplicaIva).reduce((a, r) => a + r.importe, 0);
  const importeNoGravado = itemsAll.filter(r => !r.aplicaIva).reduce((a, r) => a + r.importe, 0);

  const iva = importeGravado * tasaIva;
  const total = importeNoGravado + importeGravado + iva;

  return {
    detalleCargoFijo,
    detallePotencia,
    detalleEnergia,
    importeNoGravado,
    importeGravado,
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

  // Cargo fijo/mensual
  addSection(res.__tituloCargoFijo || "CARGO FIJO");
  res.detalleCargoFijo.forEach(r => addRow(r.concepto, r.importe));

  // Potencia (solo si hay algo)
  const potSum = res.detallePotencia.reduce((a, r) => a + r.importe, 0);
  if (potSum > 0.000001) {
    addSection("CARGO POTENCIA CONTRATADA");
    res.detallePotencia.forEach(r => addRow(r.concepto, r.importe));
  }

  // Energía
  addSection("CARGO ENERGIA MENSUAL");
  res.detalleEnergia.forEach(r => addRow(r.concepto, r.importe));

  // Subtotales
  addSection("SUBTOTALES");
  addRow("Importe No Gravado", res.importeNoGravado);
  addRow("Importe Gravado 22%", res.importeGravado);
  addRow("IVA Tasa Básica 22%", res.iva);

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
    </div>
  ` : "";

  if (tipo === "escalones" || tipo === "rangos_absolutos") {
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
  if (tarifa.id === "TRS" || tarifa.id === "TGS") {
    if (kw > 40) return `${tarifa.id} aplica hasta 40 kW.`;
  }
  if (tarifa.id === "TCB") {
    if (kw > 3.7) return "TCB aplica para potencia contratada <= 3,7 kW.";
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
