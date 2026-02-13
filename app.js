// ================================
// Simulador UTE (interno) - TRS
// Ajustes de visualización pedidos por Agus:
// - Energía: mostrar kWh facturados por escalón (no rangos)
// - No mostrar "(IVA)"
// - Decimales con coma (formato es-UY)
// - Secciones: Cargo Fijo / Potencia / Energía / Subtotales
// - Subtotales: No Gravado, Gravado 22%, IVA
// - TOTAL en negrita
// ================================

const DATA = {
  tarifas: [
    {
      id: "residencial_simple",
      nombre: "Tarifa Residencial Simple (<= 40 kW, 230/400V)",
      cargoFijo: 324.9,
      potencia: { precioPorkW: 83.2 },
      energia: {
        tipo: "escalones",
        escalones: [
          { hastaIncluye: 100, precioPorKWh: 6.744 },
          { hastaIncluye: 600, precioPorKWh: 8.452 },
          { hastaIncluye: null, precioPorKWh: 10.539 }
        ]
      },
      iva: {
        tasa: 0.22,
        aplica: {
          cargoFijo: false,
          potencia: true,
          energia: true,
          reactiva: true
        }
      },
      notas: "Modalidad Residencial. Potencia contratada <= 40 kW."
    }
  ]
};

// ---------- Formatos ----------
function fmtMoneyUY(n) {
  return new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU" }).format(n);
}
function fmtNumberUY(n, dec = 2) {
  return new Intl.NumberFormat("es-UY", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  }).format(n);
}
function fmtKwh(n) {
  // kWh normalmente entero; si llega decimal, lo muestra con coma sin miles raros
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, 2);
}
function fmtKw(n) {
  // kW puede ser decimal (ej 4,5)
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? fmtNumberUY(n, 0) : fmtNumberUY(n, 1);
}
function fmtPrice(n) {
  // precios de energía tipo 6,744 (3 decimales)
  return fmtNumberUY(n, 3);
}
function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

// ---------- Cálculo energía por escalones ----------
function calcEnergiaEscalones(kwh, escalones) {
  let restante = Math.max(0, kwh);
  let energia = 0;

  const detalle = [];
  let anteriorHasta = 0;
  let idx = 0;

  for (const esc of escalones) {
    if (restante <= 0) break;

    idx += 1;

    const hasta = esc.hastaIncluye; // number o null
    const topeActual = (hasta === null) ? Infinity : hasta;

    // Capacidad del tramo (ej: 1er tramo 100; 2do tramo 500; 3er tramo infinito)
    const maxEnTramo = (topeActual === Infinity)
      ? Infinity
      : Math.max(0, topeActual - anteriorHasta);

    const kwhEnTramo = Math.min(restante, maxEnTramo);
    const costoTramo = kwhEnTramo * esc.precioPorKWh;

    energia += costoTramo;

    // Nombre del escalón como pediste
    const nombreEscalon =
      idx === 1 ? "1er Escalón" :
      idx === 2 ? "2do Escalón" :
      idx === 3 ? "3er Escalón" :
      `${idx}º Escalón`;

    detalle.push({
      concepto: `${nombreEscalon} ${fmtKwh(kwhEnTramo)} kWh x $ ${fmtPrice(esc.precioPorKWh)}`,
      importe: costoTramo,
      aplicaIva: true
    });

    restante -= kwhEnTramo;
    anteriorHasta = (topeActual === Infinity) ? anteriorHasta : topeActual;
  }

  return { energia, detalle };
}

function calcularTarifa(tarifa, kwh, kw) {
  const kwhSafe = Math.max(0, num(kwh));
  const kwSafe  = Math.max(0, num(kw));

  const tasaIva = num(tarifa.iva?.tasa ?? 0.22);

  // Componentes base
  const cargoFijo = num(tarifa.cargoFijo);
  const potenciaPrecio = num(tarifa.potencia?.precioPorkW);
  const potencia = kwSafe * potenciaPrecio;

  // Energía
  let energia = 0;
  let detalleEnergia = [];

  if (tarifa.energia?.tipo === "escalones") {
    const res = calcEnergiaEscalones(kwhSafe, tarifa.energia.escalones);
    energia = res.energia;
    detalleEnergia = res.detalle;
  } else {
    throw new Error("Tipo de energía no soportado aún: " + tarifa.energia?.tipo);
  }

  // IVA aplicabilidad (según lo que definiste)
  const ivaAplicaCargoFijo = !!tarifa.iva?.aplica?.cargoFijo; // false
  const ivaAplicaPotencia  = !!tarifa.iva?.aplica?.potencia;  // true
  const ivaAplicaEnergia   = !!tarifa.iva?.aplica?.energia;   // true

  // Detalle por componentes (sin “(IVA)”)
  const detalleCargoFijo = [
    { concepto: "Cargo fijo mensual", importe: cargoFijo, aplicaIva: ivaAplicaCargoFijo }
  ];

  const detallePotencia = [
    { concepto: `${fmtKw(kwSafe)} kW x ${fmtNumberUY(potenciaPrecio, 1)}`, importe: potencia, aplicaIva: ivaAplicaPotencia }
  ];

  // detalleEnergia ya viene con concepto "Escalón X kWh x $ precio"
  detalleEnergia = detalleEnergia.map(d => ({ ...d, aplicaIva: ivaAplicaEnergia }));

  // Totales
  const itemsAll = [...detalleCargoFijo, ...detallePotencia, ...detalleEnergia];
  const subtotal = itemsAll.reduce((acc, r) => acc + r.importe, 0);

  const importeGravado = itemsAll.filter(r => r.aplicaIva).reduce((acc, r) => acc + r.importe, 0);
  const importeNoGravado = itemsAll.filter(r => !r.aplicaIva).reduce((acc, r) => acc + r.importe, 0);

  const iva = importeGravado * tasaIva;
  const total = subtotal + iva;

  return {
    detalleCargoFijo,
    detallePotencia,
    detalleEnergia,
    importeNoGravado,
    importeGravado,
    iva,
    total
  };
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

function fillTarifas() {
  tarifaSelect.innerHTML = "";
  for (const t of DATA.tarifas) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.nombre;
    tarifaSelect.appendChild(opt);
  }
}

function getTarifaById(id) {
  const t = DATA.tarifas.find(x => x.id === id);
  if (!t) throw new Error("Tarifa no encontrada: " + id);
  return t;
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

function render(res, tarifa) {
  detalleBody.innerHTML = "";

  // CARGO FIJO
  addSection("CARGO FIJO");
  for (const r of res.detalleCargoFijo) addRow(r.concepto, r.importe);

  // CARGO POTENCIA CONTRATADA
  addSection("CARGO POTENCIA CONTRATADA");
  for (const r of res.detallePotencia) addRow(r.concepto, r.importe);

  // CARGO ENERGIA MENSUAL
  addSection("CARGO ENERGIA MENSUAL");
  for (const r of res.detalleEnergia) addRow(r.concepto, r.importe);

  // SUBTOTALES
  addSection("SUBTOTALES");
  addRow("Importe No Gravado", res.importeNoGravado);
  addRow("Importe Gravado 22%", res.importeGravado);
  addRow("IVA", res.iva);

  // TOTAL
  totalOut.textContent = fmtMoneyUY(res.total);

  notaTarifa.textContent = tarifa.notas || "";
  resultCard.style.display = "block";
}

calcBtn.addEventListener("click", () => {
  try {
    const tarifa = getTarifaById(tarifaSelect.value);
    const kwh = Number(kwhInput.value);
    const kw  = Number(kwInput.value);

    if (!Number.isFinite(kwh) || kwh < 0) return alert("kWh inválidos");
    if (!Number.isFinite(kw) || kw < 0) return alert("kW inválidos");

    const res = calcularTarifa(tarifa, kwh, kw);
    render(res, tarifa);
  } catch (e) {
    console.error(e);
    alert("Error: " + (e?.message || e));
  }
});

fillTarifas();
