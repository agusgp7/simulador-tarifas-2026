// --- Cargamos tarifas (por ahora embebidas; luego podés moverlo a tarifas.json) ---
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
      notas: "Modalidad Residencial. Potencia contratada <= 40 kW."
    }
  ]
};

function moneyUY(n) {
  // Formato simple (sin símbolo, con 2 decimales). Si querés: "es-UY" + moneda UYU.
  return Number(n).toFixed(2);
}

function calcEnergiaEscalones(kwh, escalones) {
  let restante = Math.max(0, kwh);
  let energia = 0;
  const detalle = [];

  let desde = 1; // solo para mostrar rangos "1-100", etc. (no afecta cálculo)
  let anteriorHasta = 0;

  for (const esc of escalones) {
    if (restante <= 0) break;

    const hasta = esc.hastaIncluye; // number o null (sin tope)
    const topeActual = (hasta === null) ? Infinity : hasta;

    // Cantidad de kWh que caen en este tramo:
    // tramo 1: hasta 100
    // tramo 2: 101-600 (500 kWh)
    // tramo 3: 601+ (lo que reste)
    const maxEnTramo = (topeActual === Infinity)
      ? Infinity
      : Math.max(0, topeActual - anteriorHasta);

    const enTramo = Math.min(restante, maxEnTramo);
    const costoTramo = enTramo * esc.precioPorKWh;

    energia += costoTramo;

    // Para el desglose
    const rangoLabel = (topeActual === Infinity)
      ? `${anteriorHasta + 1}+ kWh`
      : `${anteriorHasta + 1}–${topeActual} kWh`;

    detalle.push({
      concepto: `Energía (${rangoLabel} @ ${esc.precioPorKWh} $/kWh)`,
      importe: costoTramo
    });

    restante -= enTramo;
    anteriorHasta = (topeActual === Infinity) ? anteriorHasta : topeActual;
  }

  return { energia, detalle };
}

function calcularTarifa(tarifa, kwh, kw) {
  const cargoFijo = tarifa.cargoFijo;
  const potencia = Math.max(0, kw) * tarifa.potencia.precioPorkW;

  let energia = 0;
  let detalleEnergia = [];

  if (tarifa.energia.tipo === "escalones") {
    const res = calcEnergiaEscalones(Math.max(0, kwh), tarifa.energia.escalones);
    energia = res.energia;
    detalleEnergia = res.detalle;
  } else {
    throw new Error("Tipo de energía no soportado aún: " + tarifa.energia.tipo);
  }

  const detalle = [
    { concepto: "Cargo fijo mensual", importe: cargoFijo },
    { concepto: `Potencia contratada (${tarifa.potencia.precioPorkW} $/kW)`, importe: potencia },
    ...detalleEnergia
  ];

  const total = cargoFijo + potencia + energia;

  return { total, detalle };
}

// --- UI ---
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

function render(res, tarifa) {
  totalOut.textContent = moneyUY(res.total);
  totalOut2.textContent = moneyUY(res.total);

  detalleBody.innerHTML = "";
  for (const row of res.detalle) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.concepto}</td><td class="right">${moneyUY(row.importe)}</td>`;
    detalleBody.appendChild(tr);
  }

  notaTarifa.textContent = tarifa.notas || "";
  resultCard.style.display = "block";
}

calcBtn.addEventListener("click", () => {
  const tarifa = getTarifaById(tarifaSelect.value);
  const kwh = Number(kwhInput.value);
  const kw = Number(kwInput.value);

  if (!Number.isFinite(kwh) || kwh < 0) return alert("kWh inválidos");
  if (!Number.isFinite(kw) || kw < 0) return alert("kW inválidos");

  const res = calcularTarifa(tarifa, kwh, kw);
  render(res, tarifa);
});

fillTarifas();
