// ================================
// Simulador UTE (interno) - v0.2
// - IVA 22%: cargo fijo NO, resto SÍ (según lo indicado por Agus)
// - Desglose + Subtotal + IVA + Total
// ================================

// Por ahora dejamos tarifas embebidas (simple).
// Más adelante lo movemos a tarifas.json para que sea editable sin tocar código.
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

function moneyUY(n) {
  return new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU" }).format(n);
}

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

// Calcula energía por escalones y devuelve detalle por tramo
function calcEnergiaEscalones(kwh, escalones) {
  let restante = Math.max(0, kwh);
  let energia = 0;
  const detalle = [];

  let anteriorHasta = 0;

  for (const esc of escalones) {
    if (restante <= 0) break;

    const hasta = esc.hastaIncluye; // number o null (sin tope)
    const topeActual = (hasta === null) ? Infinity : hasta;

    const maxEnTramo = (topeActual === Infinity)
      ? Infinity
      : Math.max(0, topeActual - anteriorHasta);

    const enTramo = Math.min(restante, maxEnTramo);
    const costoTramo = enTramo * esc.precioPorKWh;

    energia += costoTramo;

    const rangoLabel = (topeActual === Infinity)
      ? `${anteriorHasta + 1}+ kWh`
      : `${anteriorHasta + 1}–${topeActual} kWh`;

    detalle.push({
      concepto: `Energía (${rangoLabel} @ ${esc.precioPorKWh} $/kWh)`,
      importe: costoTramo
      // aplicaIva se agrega luego según regla de tarifa
    });

    restante -= enTramo;
    anteriorHasta = (topeActual === Infinity) ? anteriorHasta : topeActual;
  }

  return { energia, detalle };
}

function calcularTarifa(tarifa, kwh, kw) {
  const kwhSafe = Math.max(0, num(kwh));
  const kwSafe  = Math.max(0, num(kw));

  const cargoFijo = num(tarifa.cargoFijo);
  const potencia  = kwSafe * num(tarifa.potencia?.precioPorkW);

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

  // IVA rules
  const tasaIva = num(tarifa.iva?.tasa ?? 0.22);
  const ivaAplicaCargoFijo = !!tarifa.iva?.aplica?.cargoFijo;
  const ivaAplicaPotencia  = !!tarifa.iva?.aplica?.potencia;
  const ivaAplicaEnergia   = !!tarifa.iva?.aplica?.energia;

  // Detalle base (sin IVA sumado aún)
  const detalle = [
    { concepto: "Cargo fijo mensual", importe: cargoFijo, aplicaIva: ivaAplicaCargoFijo },
    { concepto: `Potencia contratada (${num(tarifa.potencia?.precioPorkW)} $/kW)`, importe: potencia, aplicaIva: ivaAplicaPotencia },
    ...detalleEnergia.map(d => ({ ...d, aplicaIva: ivaAplicaEnergia }))
  ];

  const subtotal = detalle.reduce((acc, r) => acc + r.importe, 0);
  const baseIva  = detalle.filter(r => r.aplicaIva).reduce((acc, r) => acc + r.importe, 0);
  const iva      = baseIva * tasaIva;
  const total    = subtotal + iva;

  return { subtotal, baseIva, iva, total, detalle };
}

// ================================
// UI
// ================================
const tarifaSelect = document.getElementById("tarifaSelect");
const kwhInput = document.getElementById("kwhInput");
const kwInput = document.getElementById("kwInput");
const calcBtn = document.getElementById("calcBtn");

const resultCard = document.getElementById("resultCard");
const totalOut = document.getElementById("totalOut");
const totalOut2 = document.getElementById("totalOut2");
const detalleBody = document.getElementById("detalleBody");
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

function addRow(concepto, importe, opts = {}) {
  const tr = document.createElement("tr");
  const ivaTag = opts.aplicaIva === true ? ' <span class="muted">(IVA)</span>' : '';
  tr.innerHTML = `<td>${concepto}${ivaTag}</td><td class="right">${moneyUY(importe)}</td>`;
  detalleBody.appendChild(tr);
}

function render(res, tarifa) {
  detalleBody.innerHTML = "";

  // Detalle conceptos
  for (const row of res.detalle) {
    addRow(row.concepto, row.importe, { aplicaIva: row.aplicaIva });
  }

  // Subtotal / IVA / Total
  addRow("<b>Subtotal</b>", res.subtotal);
  addRow(`IVA (${Math.round((tarifa.iva?.tasa ?? 0.22) * 100)}%)`, res.iva);
  // Total en encabezado + footer
  totalOut.textContent = moneyUY(res.total);
  totalOut2.textContent = moneyUY(res.total);

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
