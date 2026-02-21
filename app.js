// ================================
// Simulador UTE (interno) - app.js
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
function fmtPercentSigned(pct) { return fmtNumberUY(pct, 2) + "%"; }
function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}
function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

// ---------- Energía por escalones ----------
function calcEnergiaEscalones(kwh, escalones) {
  let restante = Math.max(0, kwh);
  const detalle = [];
  let anteriorHasta = 0;
  let idx = 0;

  for (const esc of escalones) {
    if (restante <= 0) break;
    idx++;

    const hasta = esc.hastaIncluye;
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

// ---------- Energía por rangos absolutos (TCB) ----------
function calcEnergiaRangosAbsolutos(kwhTotal, rangos) {
  const total = Math.max(0, kwhTotal);
  const detalle = [];
  let idx = 0;

  for (const r of rangos) {
    idx++;
    const desde = Number(r.desdeIncluye);
    const hasta = (r.hastaIncluye === null) ? Infinity : Number(r.hastaIncluye);

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

  const impPunta = kp * precioPunta;
  const impFuera = kf * precioFuera;

  return {
    detalle: [
      { concepto: `Punta ${fmtKwh(kp, 2)} kWh x $ ${fmtPriceKwh(precioPunta)}`, importe: impPunta },
      { concepto: `Fuera de Punta ${fmtKwh(kf, 2)} kWh x $ ${fmtPriceKwh(precioFuera)}`, importe: impFuera }
    ],
    eaTotalKwh: kp + kf,
    importePuntaSinIva: impPunta
  };
}

// ---------- Energía triple horario ----------
function calcEnergiaTripleHorario(kwhValle, precioValle, kwhLlano, precioLlano, kwhPunta, precioPunta) {
  const kv = Math.max(0, kwhValle);
  const kl = Math.max(0, kwhLlano);
  const kp = Math.max(0, kwhPunta);

  const impValle = kv * precioValle;
  const impLlano = kl * precioLlano;
  const impPunta = kp * precioPunta;

  return {
    detalle: [
      { concepto: `Valle ${fmtKwh(kv, 2)} kWh x $ ${fmtPriceKwh(precioValle)}`, importe: impValle },
      { concepto: `Llano ${fmtKwh(kl, 2)} kWh x $ ${fmtPriceKwh(precioLlano)}`, importe: impLlano },
      { concepto: `Punta ${fmtKwh(kp, 2)} kWh x $ ${fmtPriceKwh(precioPunta)}`, importe: impPunta }
    ],
    eaTotalKwh: kv + kl + kp,
    importePuntaSinIva: impPunta
  };
}

// ---------- Energía THE ----------
function calcEnergiaTHE(kwhPuntaHab, precioPuntaHab, kwhPuntaNoHab, precioPuntaNoHab, kwhLlano, precioLlano, kwhValle, precioValle) {
  const kh = Math.max(0, kwhPuntaHab);
  const kn = Math.max(0, kwhPuntaNoHab);
  const kl = Math.max(0, kwhLlano);
  const kv = Math.max(0, kwhValle);

  const impHab = kh * precioPuntaHab;
  const impNoH = kn * precioPuntaNoHab;
  const impLl  = kl * precioLlano;
  const impVa  = kv * precioValle;

  const importePuntaSinIva = impHab + impNoH;

  return {
    detalle: [
      { concepto: `Punta días hábiles ${fmtKwh(kh, 2)} kWh x $ ${fmtPriceKwh(precioPuntaHab)}`, importe: impHab },
      { concepto: `Punta días NO hábiles ${fmtKwh(kn, 2)} kWh x $ ${fmtPriceKwh(precioPuntaNoHab)}`, importe: impNoH },
      { concepto: `Llano ${fmtKwh(kl, 2)} kWh x $ ${fmtPriceKwh(precioLlano)}`, importe: impLl },
      { concepto: `Valle ${fmtKwh(kv, 2)} kWh x $ ${fmtPriceKwh(precioValle)}`, importe: impVa }
    ],
    eaTotalKwh: kh + kn + kl + kv,
    importePuntaSinIva
  };
}

// ---------- Reactiva Grupo 1 ----------
function calcReactivaGrupo1(eaKwhTotal, erKvarhTotal, energiaActivaImporteSinIva) {
  const ea = Math.max(0, eaKwhTotal);
  const er = Math.max(0, erKvarhTotal);
  if (ea <= 0) return { coefTotal: 0, cargo: 0 };

  const ratio = er / ea;

  let k1 = 0;
  let k1ad = 0;

  if (ratio > 0.426) k1 = 0.4 * (ratio - 0.426);
  if (ratio > 0.7) k1ad = 0.6 * (ratio - 0.7);

  const coefTotal = k1 + k1ad;
  const cargo = coefTotal * Math.max(0, energiaActivaImporteSinIva);

  return { coefTotal, cargo };
}

// ---------- Reactiva Grupo 2 (TRD) ----------
function calcReactivaGrupo2TRD(eaTotalKwh, erTotalKvarh, importePuntaSinIva) {
  const ea = Math.max(0, eaTotalKwh);
  const er = Math.max(0, erTotalKvarh);
  if (ea <= 0) return { coefTotal: 0, cargo: 0 };

  const ratio = er / ea;

  const k1 = 0.36 * (ratio - 0.426);
  const k1ad = (ratio > 0.7) ? (0.64 * (ratio - 0.7)) : 0;

  const coefTotal = k1 + k1ad;
  const cargo = coefTotal * Math.max(0, importePuntaSinIva);

  return { coefTotal, cargo };
}

// ---------- Reactiva Grupo 3 (energía) ----------
function calcReactivaGrupo3Energia(eaTotalKwh, erTotalKvarh, importePuntaSinIva, A) {
  const ea = Math.max(0, eaTotalKwh);
  const er = Math.max(0, erTotalKvarh);
  if (ea <= 0) return { coefTotal: 0, cargo: 0 };

  const ratio = er / ea;

  const k1 = (A / 100) * (ratio - 0.426);
  const k1ad = (ratio > 0.7) ? (((100 - A) / 100) * (ratio - 0.7)) : 0;

  const coefTotal = k1 + k1ad;
  const cargo = coefTotal * Math.max(0, importePuntaSinIva);

  return { coefTotal, cargo };
}

// ---------- Reactiva Grupo 3 (potencia) ----------
function calcReactivaGrupo3Potencia(eaTotalKwh, erTotalKvarh, importePotenciaLeidaTramo) {
  const ea = Math.max(0, eaTotalKwh);
  const er = Math.max(0, erTotalKvarh);
  if (ea <= 0) return { coefTotal: 0, cargo: 0 };

  const ratio = er / ea;

  const k2 = 0.62 * (ratio - 0.426);
  const k2ad = (ratio > 0.7) ? (0.38 * (ratio - 0.7)) : 0;

  const coefTotal = k2 + k2ad;
  const cargo = coefTotal * Math.max(0, importePotenciaLeidaTramo);

  return { coefTotal, cargo };
}

// ---------- Reactiva Grupo 3.2 (SOLO potencia, umbral 0,329, usa Q1+Q4) ----------
function calcReactivaGrupo32PotenciaOnly(eaTotalKwh, erSumQ1Q4, importePotenciaLeidaTramo) {
  const ea = Math.max(0, eaTotalKwh);
  const er = Math.max(0, erSumQ1Q4);
  if (ea <= 0) return { coefTotal: 0, cargo: 0 };

  const ratio = er / ea;

  const k = 0.62 * (ratio - 0.329);
  const kad = (ratio > 0.7) ? (0.38 * (ratio - 0.7)) : 0;

  const coefTotal = k + kad;
  const cargo = coefTotal * Math.max(0, importePotenciaLeidaTramo);

  return { coefTotal, cargo };
}

// ---------- Potencia MC1 (2 tramos + mínimo + excedentaria) ----------
function calcPotenciaMCTramos(params) {
  const {
    contrPL, contrV,
    leidaPL, leidaV,
    precioPL, precioV,
    minimoFactor, umbralFactor, factor1, factor2
  } = params;

  const minPL = minimoFactor * contrPL;
  const minV  = minimoFactor * contrV;

  const factPL = Math.max(leidaPL, minPL);
  const factV  = Math.max(leidaV, minV);

  const basePL = factPL * precioPL;
  const baseV  = factV  * precioV;

  function excedTramo(leida, contratada, precio) {
    if (leida <= contratada) return { kW1: 0, kW2: 0, importe: 0 };

    const umbral = contratada * umbralFactor;
    const kW1 = Math.max(0, Math.min(leida, umbral) - contratada);
    const kW2 = Math.max(0, leida - umbral);

    const importe = (kW1 * precio * factor1) + (kW2 * precio * factor2);
    return { kW1, kW2, importe };
  }

  const excPL = excedTramo(leidaPL, contrPL, precioPL);
  const excV  = excedTramo(leidaV,  contrV,  precioV);

  return { factPL, factV, basePL, baseV, excPL, excV };
}

// ---------- Potencia MC2/MC3/GC (3 tramos + mínimo + excedentaria) ----------
function calcPotenciaMC3Tramos(params) {
  const {
    contrP, contrL, contrV,
    leidaP, leidaL, leidaV,
    precioP, precioL, precioV,
    minimoFactor, umbralFactor, factor1, factor2
  } = params;

  function tramo(contr, leida, precio) {
    const min = minimoFactor * contr;
    const fact = Math.max(leida, min);
    const base = fact * precio;

    let kW1 = 0, kW2 = 0, impExc = 0;

    if (leida > contr) {
      const umbral = contr * umbralFactor;
      kW1 = Math.max(0, Math.min(leida, umbral) - contr);
      kW2 = Math.max(0, leida - umbral);
      impExc = (kW1 * precio * factor1) + (kW2 * precio * factor2);
    }

    return { fact, base, kW1, kW2, impExc };
  }

  const tP = tramo(contrP, leidaP, precioP);
  const tL = tramo(contrL, leidaL, precioL);
  const tV = tramo(contrV, leidaV, precioV);

  return { tP, tL, tV };
}

// ---------- Cálculo general ----------
function calcularTarifa(tarifa, inputs) {
  const tasaIva = num(tarifa.iva?.tasa ?? 0.22);
  const aplica = tarifa.iva?.aplica ?? {};

  const ui = tarifa.ui || {};
  const tituloCargoFijo = ui.tituloCargoFijo || "CARGO FIJO";
  const labelCargoFijo = ui.labelCargoFijo || "Cargo fijo mensual";

  const detalleCargo = [];
  if (Number.isFinite(Number(tarifa.cargoFijo)) && num(tarifa.cargoFijo) !== 0) {
    detalleCargo.push({
      concepto: labelCargoFijo,
      importe: num(tarifa.cargoFijo),
      aplicaIva: !!aplica.cargoFijo,
      __titulo: tituloCargoFijo
    });
  }

  const detallePotencia = [];
  const detalleEnergia = [];

  let eaTotalKwh = 0;
  let energiaActivaImporteSinIva = 0;
  let energiaPuntaImporteSinIva = 0;

  // para reactiva potencia por tramo
  let mc_leidaPL = 0, mc_leidaV = 0, mc_precioPL = 0, mc_precioV = 0;
  let mc3_leidaP = 0, mc3_leidaL = 0, mc3_leidaV = 0;
  let mc3_precioP = 0, mc3_precioL = 0, mc3_precioV = 0;
  let the_leidaPL = 0, the_precioKW = 0;

  // -------- POTENCIA --------
  if (tarifa.potencia?.tipo === "mc_potencia_tramos") {
    const contrPL = Math.max(0, num(inputs.mc_contrPL));
    const contrV  = Math.max(0, num(inputs.mc_contrV));
    const leidaPL = Math.max(0, num(inputs.mc_leidaPL));
    const leidaV  = Math.max(0, num(inputs.mc_leidaV));

    mc_leidaPL = leidaPL;
    mc_leidaV  = leidaV;

    const precioPL = num(tarifa.potencia.puntaLlano?.precioPorkW);
    const precioV  = num(tarifa.potencia.valle?.precioPorkW);

    mc_precioPL = precioPL;
    mc_precioV  = precioV;

    const minimoFactor = num(tarifa.potencia.minimoFactor ?? 0.5);
    const umbralFactor = num(tarifa.potencia.excedentaria?.umbralFactor ?? 1.3);
    const factor1      = num(tarifa.potencia.excedentaria?.factorEscalon1 ?? 1.0);
    const factor2      = num(tarifa.potencia.excedentaria?.factorEscalon2 ?? 3.0);

    const res = calcPotenciaMCTramos({
      contrPL, contrV, leidaPL, leidaV,
      precioPL, precioV,
      minimoFactor, umbralFactor, factor1, factor2
    });

    detallePotencia.push({
      concepto: `Cargo por Potencia (Punta-Llano) ${fmtKw(res.factPL)} kW x $ ${fmtPriceKw(precioPL)}`,
      importe: res.basePL,
      aplicaIva: !!aplica.potencia
    });
    detallePotencia.push({
      concepto: `Cargo por Potencia Valle ${fmtKw(res.factV)} kW x $ ${fmtPriceKw(precioV)}`,
      importe: res.baseV,
      aplicaIva: !!aplica.potencia
    });

    if (res.excPL.importe > 0) {
      if (res.excPL.kW1 > 0) {
        detallePotencia.push({
          concepto: `Recargo Potencia Excedentaria (Punta-Llano) ${fmtKw(res.excPL.kW1)} kW x $ ${fmtPriceKw(precioPL)} x 100%`,
          importe: res.excPL.kW1 * precioPL * factor1,
          aplicaIva: !!aplica.excedentaria
        });
      }
      if (res.excPL.kW2 > 0) {
        detallePotencia.push({
          concepto: `Recargo Potencia Excedentaria (Punta-Llano) ${fmtKw(res.excPL.kW2)} kW x $ ${fmtPriceKw(precioPL)} x 300%`,
          importe: res.excPL.kW2 * precioPL * factor2,
          aplicaIva: !!aplica.excedentaria
        });
      }
    }

    if (res.excV.importe > 0) {
      if (res.excV.kW1 > 0) {
        detallePotencia.push({
          concepto: `Recargo Potencia Excedentaria (Valle) ${fmtKw(res.excV.kW1)} kW x $ ${fmtPriceKw(precioV)} x 100%`,
          importe: res.excV.kW1 * precioV * factor1,
          aplicaIva: !!aplica.excedentaria
        });
      }
      if (res.excV.kW2 > 0) {
        detallePotencia.push({
          concepto: `Recargo Potencia Excedentaria (Valle) ${fmtKw(res.excV.kW2)} kW x $ ${fmtPriceKw(precioV)} x 300%`,
          importe: res.excV.kW2 * precioV * factor2,
          aplicaIva: !!aplica.excedentaria
        });
      }
    }

  } else if (tarifa.potencia?.tipo === "mc_potencia_3tramos") {
    const contrP = Math.max(0, num(inputs.mc3_contrP));
    const contrL = Math.max(0, num(inputs.mc3_contrL));
    const contrV = Math.max(0, num(inputs.mc3_contrV));

    const leidaP = Math.max(0, num(inputs.mc3_leidaP));
    const leidaL = Math.max(0, num(inputs.mc3_leidaL));
    const leidaV = Math.max(0, num(inputs.mc3_leidaV));

    mc3_leidaP = leidaP; mc3_leidaL = leidaL; mc3_leidaV = leidaV;

    const precioP = num(tarifa.potencia.punta?.precioPorkW);
    const precioL = num(tarifa.potencia.llano?.precioPorkW);
    const precioV = num(tarifa.potencia.valle?.precioPorkW);

    mc3_precioP = precioP; mc3_precioL = precioL; mc3_precioV = precioV;

    const minimoFactor = num(tarifa.potencia.minimoFactor ?? 1.0);
    const umbralFactor = num(tarifa.potencia.excedentaria?.umbralFactor ?? 1.3);
    const factor1      = num(tarifa.potencia.excedentaria?.factorEscalon1 ?? 1.0);
    const factor2      = num(tarifa.potencia.excedentaria?.factorEscalon2 ?? 3.0);

    const res = calcPotenciaMC3Tramos({
      contrP, contrL, contrV,
      leidaP, leidaL, leidaV,
      precioP, precioL, precioV,
      minimoFactor, umbralFactor, factor1, factor2
    });

    detallePotencia.push({ concepto: `Cargo por Potencia Punta ${fmtKw(res.tP.fact)} kW x $ ${fmtPriceKw(precioP)}`, importe: res.tP.base, aplicaIva: !!aplica.potencia });
    detallePotencia.push({ concepto: `Cargo por Potencia Llano ${fmtKw(res.tL.fact)} kW x $ ${fmtPriceKw(precioL)}`, importe: res.tL.base, aplicaIva: !!aplica.potencia });
    detallePotencia.push({ concepto: `Cargo por Potencia Valle ${fmtKw(res.tV.fact)} kW x $ ${fmtPriceKw(precioV)}`, importe: res.tV.base, aplicaIva: !!aplica.potencia });

    function pushExc(prefix, t, precio) {
      if (t.impExc <= 0) return;
      if (t.kW1 > 0) detallePotencia.push({ concepto: `Recargo Potencia Excedentaria (${prefix}) ${fmtKw(t.kW1)} kW x $ ${fmtPriceKw(precio)} x 100%`, importe: t.kW1 * precio * factor1, aplicaIva: !!aplica.excedentaria });
      if (t.kW2 > 0) detallePotencia.push({ concepto: `Recargo Potencia Excedentaria (${prefix}) ${fmtKw(t.kW2)} kW x $ ${fmtPriceKw(precio)} x 300%`, importe: t.kW2 * precio * factor2, aplicaIva: !!aplica.excedentaria });
    }
    pushExc("Punta", res.tP, precioP);
    pushExc("Llano", res.tL, precioL);
    pushExc("Valle", res.tV, precioV);

  } else if (tarifa.potencia?.tipo === "the_potencia_contratada") {
    const contrPL = Math.max(0, num(inputs.the_contrPL));
    const precioKW = num(tarifa.potencia.precioPorkW);

    detallePotencia.push({
      concepto: `${fmtKw(contrPL)} kW x $ ${fmtPriceKw(precioKW)}`,
      importe: contrPL * precioKW,
      aplicaIva: !!aplica.potencia
    });

    the_leidaPL = Math.max(0, num(inputs.the_leidaPL));
    the_precioKW = Math.max(0, precioKW);

  } else if (tarifa.potencia && Number.isFinite(Number(tarifa.potencia.precioPorkW)) && num(tarifa.potencia.precioPorkW) > 0) {
    const kw = Math.max(0, num(inputs.kw));
    const precio = num(tarifa.potencia.precioPorkW);
    detallePotencia.push({
      concepto: `${fmtKw(kw)} kW x $ ${fmtPriceKw(precio)}`,
      importe: kw * precio,
      aplicaIva: !!aplica.potencia
    });
  }

  // -------- ENERGÍA --------
  const energia = tarifa.energia || {};

  if (energia.tipo === "escalones") {
    const kwh = Math.max(0, num(inputs.kwhTotal));
    eaTotalKwh = kwh;

    const det = calcEnergiaEscalones(kwh, energia.escalones || []);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);
    det.forEach(r => detalleEnergia.push({ ...r, aplicaIva: !!aplica.energia }));

  } else if (energia.tipo === "doble_horario") {
    const kwhPuntaIn = Math.max(0, num(inputs.kwhPunta));
    const kwhFueraIn = Math.max(0, num(inputs.kwhFueraPunta));

    const precioP = num(energia.punta?.precioPorKWh);
    const precioF = num(energia.fueraPunta?.precioPorKWh);

    const res = calcEnergiaDobleHorario(kwhPuntaIn, precioP, kwhFueraIn, precioF);
    eaTotalKwh = res.eaTotalKwh;
    energiaPuntaImporteSinIva = res.importePuntaSinIva;
    energiaActivaImporteSinIva = res.detalle.reduce((a, r) => a + r.importe, 0);
    res.detalle.forEach(r => detalleEnergia.push({ ...r, aplicaIva: !!aplica.energia }));

    if (!!inputs.calculaReactiva && tarifa.reactiva?.modelo === "grupo2_trd") {
      const erTotal = Math.max(0, num(inputs.kvarh));
      const rr = calcReactivaGrupo2TRD(eaTotalKwh, erTotal, energiaPuntaImporteSinIva);
      const pct = rr.coefTotal * 100;
      const cargo = round2(rr.cargo);

      // si está tildado, aunque er=0, igual muestra (queda 0)
      detalleEnergia.push({
        concepto: `Energía Reactiva ${fmtPercentSigned(pct)} x ${fmtMoneyUY(energiaPuntaImporteSinIva)}`,
        importe: cargo,
        aplicaIva: !!aplica.reactiva
      });
    }

  } else if (energia.tipo === "triple_horario") {
    const kwhValle = Math.max(0, num(inputs.kwhValle));
    const kwhLlano = Math.max(0, num(inputs.kwhLlano));
    const kwhPunta = Math.max(0, num(inputs.kwhPunta3));

    const precioV = num(energia.valle?.precioPorKWh);
    const precioL = num(energia.llano?.precioPorKWh);
    const precioP = num(energia.punta?.precioPorKWh);

    const res = calcEnergiaTripleHorario(kwhValle, precioV, kwhLlano, precioL, kwhPunta, precioP);
    eaTotalKwh = res.eaTotalKwh;
    energiaPuntaImporteSinIva = res.importePuntaSinIva;
    energiaActivaImporteSinIva = res.detalle.reduce((a, r) => a + r.importe, 0);

    const reorderIds = new Set(["MC1", "MC2", "MC3", "GC1", "GC2", "GC3", "GC5"]);
    const detOrdenado = reorderIds.has(tarifa.id)
      ? [
          res.detalle.find(x => x.concepto.startsWith("Punta")),
          res.detalle.find(x => x.concepto.startsWith("Llano")),
          res.detalle.find(x => x.concepto.startsWith("Valle"))
        ].filter(Boolean)
      : res.detalle;

    detOrdenado.forEach(r => detalleEnergia.push({ ...r, aplicaIva: !!aplica.energia }));

  } else if (energia.tipo === "the_estacional") {
    const kh = Math.max(0, num(inputs.the_kwhPuntaHab));
    const kn = Math.max(0, num(inputs.the_kwhPuntaNoHab));
    const kl = Math.max(0, num(inputs.the_kwhLlano));
    const kv = Math.max(0, num(inputs.the_kwhValle));

    const ph = num(energia.puntaHabiles?.precioPorKWh);
    const pn = num(energia.puntaNoHabiles?.precioPorKWh);
    const pl = num(energia.llano?.precioPorKWh);
    const pv = num(energia.valle?.precioPorKWh);

    const res = calcEnergiaTHE(kh, ph, kn, pn, kl, pl, kv, pv);
    eaTotalKwh = res.eaTotalKwh;
    energiaPuntaImporteSinIva = res.importePuntaSinIva;
    energiaActivaImporteSinIva = res.detalle.reduce((a, r) => a + r.importe, 0);
    res.detalle.forEach(r => detalleEnergia.push({ ...r, aplicaIva: !!aplica.energia }));

  } else if (energia.tipo === "rangos_absolutos") {
    const kwh = Math.max(0, num(inputs.kwhTotal));
    eaTotalKwh = kwh;

    const det = calcEnergiaRangosAbsolutos(kwh, energia.rangos || []);
    energiaActivaImporteSinIva = det.reduce((a, r) => a + r.importe, 0);
    det.forEach(r => detalleEnergia.push({ ...r, aplicaIva: !!aplica.energia }));

  } else {
    throw new Error("Tipo de energía no soportado: " + (energia.tipo ?? "desconocido"));
  }

  // -------- Reactiva Grupo 1 (opcional) --------
  if (!!inputs.calculaReactiva && tarifa.reactiva?.modelo === "grupo1_k1") {
    const er = Math.max(0, num(inputs.kvarh));
    const rr = calcReactivaGrupo1(eaTotalKwh, er, energiaActivaImporteSinIva);
    const pct = rr.coefTotal * 100;
    const cargo = round2(rr.cargo);

    detalleEnergia.push({
      concepto: `Energía Reactiva ${fmtPercentSigned(pct)} x ${fmtMoneyUY(energiaActivaImporteSinIva)}`,
      importe: cargo,
      aplicaIva: !!aplica.reactiva
    });
  }

  // -------- Reactiva Grupo 3 / GC Q1 / GC 3.2 --------
  const react = tarifa.reactiva || null;
  if (react) {
    const modelo = react.modelo;

    const debeCalcular = react.always ? true : (!!inputs.calculaReactiva);

    if (debeCalcular) {
      // Er según modelo
      const erQ1 = Math.max(0, num(inputs.kvarhQ1 ?? inputs.kvarh));
      const erQ4 = Math.max(0, num(inputs.kvarhQ4 ?? 0));

      const erTotal =
        (modelo === "grupo3_gc_q1") ? erQ1 :
        (modelo === "gc_grupo3_2_pot_only") ? (erQ1 + erQ4) :
        Math.max(0, num(inputs.kvarh));

      // (1) Grupo 3 normal: energía reactiva + potencia reactiva
      if (modelo === "grupo3" || modelo === "grupo3_gc_q1") {
        const A = num(react.A ?? 23);

        // Energía reactiva sobre $punta
        const rrE = calcReactivaGrupo3Energia(eaTotalKwh, erTotal, energiaPuntaImporteSinIva, A);
        const pctE = rrE.coefTotal * 100;
        const cargoE = round2(rrE.cargo);

        // en always, aunque sea 0, lo mostramos igual
        if (energiaPuntaImporteSinIva > 0) {
          detalleEnergia.push({
            concepto: `Energía Reactiva ${fmtPercentSigned(pctE)} x ${fmtMoneyUY(energiaPuntaImporteSinIva)}`,
            importe: cargoE,
            aplicaIva: !!aplica.reactiva
          });
        }

        // Potencia reactiva por tramo según tarifa
        if (!!react.includePotenciaReactiva) {
          if (tarifa.id === "MC1") {
            const impPL = Math.max(0, mc_leidaPL) * Math.max(0, mc_precioPL);
            const impV  = Math.max(0, mc_leidaV)  * Math.max(0, mc_precioV);

            const rrPL = calcReactivaGrupo3Potencia(eaTotalKwh, erTotal, impPL);
            const rrV  = calcReactivaGrupo3Potencia(eaTotalKwh, erTotal, impV);

            detallePotencia.push({
              concepto: `Potencia Reactiva P-LL ${fmtPercentSigned(rrPL.coefTotal * 100)} x ${fmtMoneyUY(impPL)}`,
              importe: round2(rrPL.cargo),
              aplicaIva: !!aplica.reactiva
            });
            detallePotencia.push({
              concepto: `Potencia Reactiva Valle ${fmtPercentSigned(rrV.coefTotal * 100)} x ${fmtMoneyUY(impV)}`,
              importe: round2(rrV.cargo),
              aplicaIva: !!aplica.reactiva
            });
          }

          if (["MC2", "MC3", "GC1", "GC2"].includes(tarifa.id)) {
            const impP = Math.max(0, mc3_leidaP) * Math.max(0, mc3_precioP);
            const impL = Math.max(0, mc3_leidaL) * Math.max(0, mc3_precioL);
            const impV = Math.max(0, mc3_leidaV) * Math.max(0, mc3_precioV);

            const rrP = calcReactivaGrupo3Potencia(eaTotalKwh, erTotal, impP);
            const rrL = calcReactivaGrupo3Potencia(eaTotalKwh, erTotal, impL);
            const rrV = calcReactivaGrupo3Potencia(eaTotalKwh, erTotal, impV);

            detallePotencia.push({ concepto: `Potencia Reactiva Punta ${fmtPercentSigned(rrP.coefTotal * 100)} x ${fmtMoneyUY(impP)}`, importe: round2(rrP.cargo), aplicaIva: !!aplica.reactiva });
            detallePotencia.push({ concepto: `Potencia Reactiva Llano ${fmtPercentSigned(rrL.coefTotal * 100)} x ${fmtMoneyUY(impL)}`, importe: round2(rrL.cargo), aplicaIva: !!aplica.reactiva });
            detallePotencia.push({ concepto: `Potencia Reactiva Valle ${fmtPercentSigned(rrV.coefTotal * 100)} x ${fmtMoneyUY(impV)}`, importe: round2(rrV.cargo), aplicaIva: !!aplica.reactiva });
          }

          if (tarifa.id === "THE") {
            const impPL = Math.max(0, the_leidaPL) * Math.max(0, the_precioKW);
            const rr = calcReactivaGrupo3Potencia(eaTotalKwh, erTotal, impPL);
            detallePotencia.push({
              concepto: `Potencia Reactiva P-LL ${fmtPercentSigned(rr.coefTotal * 100)} x ${fmtMoneyUY(impPL)}`,
              importe: round2(rr.cargo),
              aplicaIva: !!aplica.reactiva
            });
          }
        }
      }

      // (2) GC Grupo 3.2: SOLO potencia reactiva (Q1+Q4, umbral 0,329)
      if (modelo === "gc_grupo3_2_pot_only") {
        if (!!react.includePotenciaReactiva && ["GC3", "GC5"].includes(tarifa.id)) {
          const impP = Math.max(0, mc3_leidaP) * Math.max(0, mc3_precioP);
          const impL = Math.max(0, mc3_leidaL) * Math.max(0, mc3_precioL);
          const impV = Math.max(0, mc3_leidaV) * Math.max(0, mc3_precioV);

          const rrP = calcReactivaGrupo32PotenciaOnly(eaTotalKwh, erTotal, impP);
          const rrL = calcReactivaGrupo32PotenciaOnly(eaTotalKwh, erTotal, impL);
          const rrV = calcReactivaGrupo32PotenciaOnly(eaTotalKwh, erTotal, impV);

          detallePotencia.push({ concepto: `Potencia Reactiva Punta ${fmtPercentSigned(rrP.coefTotal * 100)} x ${fmtMoneyUY(impP)}`, importe: round2(rrP.cargo), aplicaIva: !!aplica.reactiva });
          detallePotencia.push({ concepto: `Potencia Reactiva Llano ${fmtPercentSigned(rrL.coefTotal * 100)} x ${fmtMoneyUY(impL)}`, importe: round2(rrL.cargo), aplicaIva: !!aplica.reactiva });
          detallePotencia.push({ concepto: `Potencia Reactiva Valle ${fmtPercentSigned(rrV.coefTotal * 100)} x ${fmtMoneyUY(impV)}`, importe: round2(rrV.cargo), aplicaIva: !!aplica.reactiva });
        }
      }
    }
  }

  // -------- Totales --------
  const todos = [...detalleCargo, ...detallePotencia, ...detalleEnergia];
  const gravado = todos.filter(r => r.aplicaIva).reduce((a, r) => a + r.importe, 0);
  const noGravado = todos.filter(r => !r.aplicaIva).reduce((a, r) => a + r.importe, 0);

  const iva = gravado * tasaIva;
  const total = gravado + noGravado + iva;

  return { detalleCargo, detallePotencia, detalleEnergia, gravado, noGravado, iva, total, __tituloCargoFijo: tituloCargoFijo };
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

function getKwBlock() { return kwInput?.parentElement; }

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
  if (!msg) { warnBox.style.display = "none"; warnBox.textContent = ""; return; }
  warnBox.style.display = "block";
  warnBox.textContent = msg;
}

function renderInputsForTarifa(tarifa) {
  const kwBlock = getKwBlock();
  const potenciaNormalAplica =
    tarifa.potencia &&
    !tarifa.potencia.tipo &&
    Number.isFinite(Number(tarifa.potencia.precioPorkW)) &&
    num(tarifa.potencia.precioPorkW) > 0;

  if (kwBlock) {
    const hide =
      (tarifa.potencia?.tipo === "mc_potencia_tramos") ||
      (tarifa.potencia?.tipo === "mc_potencia_3tramos") ||
      (tarifa.potencia?.tipo === "the_potencia_contratada");
    kwBlock.style.display = hide ? "none" : (potenciaNormalAplica ? "block" : "none");
  }

  const tipoE = tarifa.energia?.tipo;
  const reactivaCfg = tarifa.reactiva || null;

  const alwaysReactiva = !!reactivaCfg?.always;
  const showReactivaInput = (tarifa.id !== "TCB") && !!reactivaCfg?.modelo;
  const showCheckboxReactiva = showReactivaInput && !alwaysReactiva;

  const reactivaUsaQ1Q4 = ["grupo3_gc_q1", "gc_grupo3_2_pot_only"].includes(reactivaCfg?.modelo);

  const reactivaBlock = showReactivaInput ? `
    ${showCheckboxReactiva ? `
      <div class="inline">
        <input id="calculaReactiva" type="checkbox" ${reactivaCfg?.defaultCalcula ? "checked" : ""} />
        <label for="calculaReactiva" style="margin:0;">Calcula Reactiva</label>
      </div>
    ` : ``}
    <div id="reactivaInputs" style="display:${alwaysReactiva ? "block" : "none"};">
      ${reactivaUsaQ1Q4 ? `
        <div class="row">
          <div>
            <label>Energía reactiva Q1 (kVArh)</label>
            <input id="kvarhQ1" type="number" min="0" step="0.01" value="0" />
          </div>
          <div>
            <label>Energía reactiva Q4 (kVArh)</label>
            <input id="kvarhQ4" type="number" min="0" step="0.01" value="0" />
          </div>
        </div>
      ` : `
        <div class="row">
          <div>
            <label>Energía reactiva (kVArh)</label>
            <input id="kvarh" type="number" min="0" step="0.01" value="0" />
          </div>
          <div></div>
        </div>
      `}
    </div>
  ` : "";

  const mc1Pot = (tarifa.potencia?.tipo === "mc_potencia_tramos") ? `
    <div class="row">
      <div><label>Potencia contratada Punta - Llano (kW)</label><input id="mc_contrPL" type="number" min="0" step="0.1" value="0" /></div>
      <div><label>Potencia contratada Valle (kW)</label><input id="mc_contrV" type="number" min="0" step="0.1" value="0" /></div>
    </div>
    <div class="row">
      <div><label>Potencia leída Punta - Llano (kW)</label><input id="mc_leidaPL" type="number" min="0" step="0.1" value="0" /></div>
      <div><label>Potencia leída Valle (kW)</label><input id="mc_leidaV" type="number" min="0" step="0.1" value="0" /></div>
    </div>
  ` : "";

  const mc3Pot = (tarifa.potencia?.tipo === "mc_potencia_3tramos") ? `
    <div class="row">
      <div><label>Potencia Contratada Punta (kW)</label><input id="mc3_contrP" type="number" min="0" step="0.1" value="0" /></div>
      <div><label>Potencia Contratada Llano (kW)</label><input id="mc3_contrL" type="number" min="0" step="0.1" value="0" /></div>
    </div>
    <div class="row">
      <div><label>Potencia Contratada Valle (kW)</label><input id="mc3_contrV" type="number" min="0" step="0.1" value="0" /></div>
      <div></div>
    </div>
    <div class="row">
      <div><label>Potencia leída Punta (kW)</label><input id="mc3_leidaP" type="number" min="0" step="0.1" value="0" /></div>
      <div><label>Potencia leída Llano (kW)</label><input id="mc3_leidaL" type="number" min="0" step="0.1" value="0" /></div>
    </div>
    <div class="row">
      <div><label>Potencia leída Valle (kW)</label><input id="mc3_leidaV" type="number" min="0" step="0.1" value="0" /></div>
      <div></div>
    </div>
  ` : "";

  const thePot = (tarifa.potencia?.tipo === "the_potencia_contratada") ? `
    <div class="row">
      <div><label>Potencia contratada Punta - Llano (kW)</label><input id="the_contrPL" type="number" min="0" step="0.1" value="0" /></div>
      <div><label>Potencia contratada Valle (kW)</label><input id="the_contrV" type="number" min="0" step="0.1" value="0" /></div>
    </div>
    <div class="row">
      <div><label>Potencia leída Punta - Llano (kW)</label><input id="the_leidaPL" type="number" min="0" step="0.1" value="0" /></div>
      <div><label>Potencia leída Valle (kW)</label><input id="the_leidaV" type="number" min="0" step="0.1" value="0" /></div>
    </div>
  ` : "";

  if (tipoE === "doble_horario") {
    energyInputs.innerHTML = `
      <div class="row">
        <div><label>Consumo mensual Punta (kWh)</label><input id="kwhPunta" type="number" min="0" step="0.01" value="0" /></div>
        <div><label>Consumo mensual Fuera de Punta (kWh)</label><input id="kwhFueraPunta" type="number" min="0" step="0.01" value="0" /></div>
      </div>
      ${reactivaBlock}
    `;
  } else if (tipoE === "triple_horario") {
    energyInputs.innerHTML = `
      ${mc1Pot}
      ${mc3Pot}
      <div class="row">
        <div><label>Consumo mensual Punta (kWh)</label><input id="kwhPunta3" type="number" min="0" step="0.01" value="0" /></div>
        <div><label>Consumo mensual Llano (kWh)</label><input id="kwhLlano" type="number" min="0" step="0.01" value="0" /></div>
      </div>
      <div class="row">
        <div><label>Consumo mensual Valle (kWh)</label><input id="kwhValle" type="number" min="0" step="0.01" value="0" /></div>
        <div></div>
      </div>
      ${reactivaBlock}
    `;
  } else if (tipoE === "the_estacional") {
    energyInputs.innerHTML = `
      ${thePot}
      <div class="row">
        <div><label>Consumo mensual Punta días hábiles (kWh)</label><input id="the_kwhPuntaHab" type="number" min="0" step="0.01" value="0" /></div>
        <div><label>Consumo mensual Punta días NO hábiles (kWh)</label><input id="the_kwhPuntaNoHab" type="number" min="0" step="0.01" value="0" /></div>
      </div>
      <div class="row">
        <div><label>Consumo mensual Llano (kWh)</label><input id="the_kwhLlano" type="number" min="0" step="0.01" value="0" /></div>
        <div><label>Consumo mensual Valle (kWh)</label><input id="the_kwhValle" type="number" min="0" step="0.01" value="0" /></div>
      </div>
      ${reactivaBlock}
    `;
  } else if (tipoE === "escalones" || tipoE === "rangos_absolutos") {
    energyInputs.innerHTML = `
      <div class="row">
        <div><label>Consumo mensual (kWh)</label><input id="kwhTotal" type="number" min="0" step="0.01" value="0" /></div>
        <div></div>
      </div>
      ${reactivaBlock}
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

  showWarn("");
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

calcBtn.addEventListener("click", () => {
  const tarifa = getTarifaActual();
  if (!tarifa) return;

  const inputs = {
    kw: kwInput.value,
    kwhTotal: document.getElementById("kwhTotal")?.value,

    kwhPunta: document.getElementById("kwhPunta")?.value,
    kwhFueraPunta: document.getElementById("kwhFueraPunta")?.value,

    kwhPunta3: document.getElementById("kwhPunta3")?.value,
    kwhLlano: document.getElementById("kwhLlano")?.value,
    kwhValle: document.getElementById("kwhValle")?.value,

    calculaReactiva: document.getElementById("calculaReactiva")?.checked ?? false,

    kvarh: document.getElementById("kvarh")?.value,
    kvarhQ1: document.getElementById("kvarhQ1")?.value,
    kvarhQ4: document.getElementById("kvarhQ4")?.value,

    mc_contrPL: document.getElementById("mc_contrPL")?.value,
    mc_contrV: document.getElementById("mc_contrV")?.value,
    mc_leidaPL: document.getElementById("mc_leidaPL")?.value,
    mc_leidaV: document.getElementById("mc_leidaV")?.value,

    mc3_contrP: document.getElementById("mc3_contrP")?.value,
    mc3_contrL: document.getElementById("mc3_contrL")?.value,
    mc3_contrV: document.getElementById("mc3_contrV")?.value,
    mc3_leidaP: document.getElementById("mc3_leidaP")?.value,
    mc3_leidaL: document.getElementById("mc3_leidaL")?.value,
    mc3_leidaV: document.getElementById("mc3_leidaV")?.value,

    the_contrPL: document.getElementById("the_contrPL")?.value,
    the_contrV: document.getElementById("the_contrV")?.value,
    the_leidaPL: document.getElementById("the_leidaPL")?.value,
    the_leidaV: document.getElementById("the_leidaV")?.value,

    the_kwhPuntaHab: document.getElementById("the_kwhPuntaHab")?.value,
    the_kwhPuntaNoHab: document.getElementById("the_kwhPuntaNoHab")?.value,
    the_kwhLlano: document.getElementById("the_kwhLlano")?.value,
    the_kwhValle: document.getElementById("the_kwhValle")?.value
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
