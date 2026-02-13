// ================================
// Simulador UTE (interno)
// Lee tarifas desde tarifas.json
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
      importe: costoTramo,
      aplicaIva: true
    });

    restante -= kwhEnTramo;
    anteriorHasta = (topeActual === Infinity) ? anteriorHasta : topeActual;
  }

  return detalle;
}

function calcularTarifa(tarifa, kwh, kw) {
  const kwhSafe = Math.max(0, num(kwh));
  const kwSafe  = Math.max(0, num(kw));

  const tasaIva = num(tarifa.iva?.tasa ?? 0.22);

  const cargoFijo = num(tarifa.cargoFijo);
  const potenciaPrecio = num(tarifa.potencia?.precioPorkW);
  const potencia = kwSafe * potenciaPrecio;

  const ivaAplicaCargoFijo = !!tarifa.iva?.aplica?.cargoFijo; // false
  const ivaAplicaPotencia  = !!tarifa.iva?.aplica?.potencia;  // true
  const ivaAplicaEnergia   = !!tarifa.iva?.aplica?.energia;   // true

  const detalleCargoFijo = [
    { concepto: "Cargo fijo mensual", importe: cargoFijo, aplicaIva: ivaAplicaCargoFijo }
  ];

  const detallePotencia = [
    { concepto: `${fmtKw(kwSafe)} kW x $ ${fmtPriceKw(potenciaPrecio)}`, importe: potencia, aplicaIva: ivaAplicaPotencia }
  ];

  let detalleEnergia = [];
  if (tarifa.energia?.tipo === "escalones") {
    detalleEnergia = calcEnergiaEscalones(kwhSafe, tarifa.energia.escalones)
      .map(d => ({ ...d, aplicaIva: ivaAplicaEnergia }));
  } else {
    throw new Error("Tipo de energía no soportado aún: " + tarifa.energia?.tipo);
  }

  const itemsAll = [...detalleCargoFijo, ...detallePotencia, ...detalleEnergia];
  const importeGravado = itemsAll.filter(r => r.aplicaIva).reduce((a, r) => a + r.importe, 0);
  const importeNoGravado = itemsAll.filter(r => !r.aplicaIva).reduce((a, r) => a + r.importe, 0);

  const iva = importeGravado * tasaIva;
  const total = importeNoGravado + importeGravado + iva;

  return { detalleCargoFijo, detallePotencia, detalleEnergia, importeNoGravado, importeGravado, iva, total };
}

// ---------- UI ----------
const tarifaSelect = document.getElementById("tarifaSelect");
const kwhInput = document.getElementById("kwhInput");
const kwInput = document.getElementById("kwInput");
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

function fillTarifas() {
  tarifaSelect.innerHTML = "";
  DATA.tarifas.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.nombre;
    tarifaSelect.appendChild(opt);
  });
}

calcBtn.addEventListener("click", () => {
  const tarifa = DATA.tarifas.find(t => t.id === tarifaSelect.value);
  const res = calcularTarifa(tarifa, kwhInput.value, kwInput.value);
  render(res, tarifa);
});

// ---------- Cargar tarifas.json ----------
fetch("./tarifas.json", { cache: "no-store" })
  .then(r => r.json())
  .then(json => {
    DATA = json;
    fillTarifas();
  })
  .catch(err => {
    console.error(err);
    alert("No se pudo cargar tarifas.json");
  });
