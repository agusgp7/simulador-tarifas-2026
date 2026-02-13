// ================================
// Panel de precios (mini backoffice)
// - Vista para todos
// - Edición solo con clave (preventivo, no seguridad fuerte)
// - Exporta tarifas.json para subir al repo
// ================================

// ⚠️ Cambiá esta clave por la tuya (solo vos la sabés)
const EDIT_PASSWORD = "AGUS-UTE-2026";

let originalDATA = null;   // tal cual vino del JSON
let workingDATA = null;    // copia editable en memoria
let editEnabled = false;

const tarifaSelect = document.getElementById("tarifaSelect");
const formCard = document.getElementById("formCard");
const btnEnableEdit = document.getElementById("btnEnableEdit");
const btnDisableEdit = document.getElementById("btnDisableEdit");
const modeLabel = document.getElementById("modeLabel");
const statusBox = document.getElementById("statusBox");

function setStatus(type, msg) {
  statusBox.innerHTML = msg ? `<div class="${type}">${msg}</div>` : "";
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function parseNumberAny(s) {
  // acepta "6,744" o "6.744" o "1.234,56"
  if (typeof s === "number") return s;
  s = String(s ?? "").trim();
  if (!s) return NaN;
  s = s.replace(/\s+/g, "");
  // si tiene coma y punto, asumimos miles con punto y decimal coma
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // si solo coma, decimal coma
    s = s.replace(",", ".");
  }
  return Number(s);
}

function fmtForInput(n, decimals = 3) {
  if (!Number.isFinite(n)) return "";
  // Para inputs es mejor punto decimal
  return Number(n).toFixed(decimals);
}

function renderTarifaForm(tarifa) {
  const isReadOnly = !editEnabled;

  const energia = tarifa.energia || {};
  const iva = tarifa.iva || { tasa: 0.22, aplica: {} };
  const aplica = iva.aplica || {};

  // Armamos HTML del formulario
  let html = `
    <div class="${isReadOnly ? "readonly" : ""}">
      <div class="sectionTitle">Datos generales</div>
      <label>Nombre</label>
      <input id="f_nombre" ${isReadOnly ? "readonly" : ""} value="${escapeHtml(tarifa.nombre ?? "")}" />

      <label>Notas</label>
      <textarea id="f_notas" ${isReadOnly ? "readonly" : ""}>${escapeHtml(tarifa.notas ?? "")}</textarea>

      <div class="sectionTitle">Cargo fijo</div>
      <div class="grid2">
        <div>
          <label>Cargo fijo mensual ($)</label>
          <input id="f_cargoFijo" ${isReadOnly ? "readonly" : ""} value="${fmtForInput(tarifa.cargoFijo, 2)}" />
          <div class="muted">No gravado (según tu regla actual).</div>
        </div>
      </div>

      <div class="sectionTitle">Potencia</div>
      <div class="grid2">
        <div>
          <label>Precio potencia ($/kW)</label>
          <input id="f_pot_precio" ${isReadOnly ? "readonly" : ""} value="${fmtForInput(tarifa.potencia?.precioPorkW, 1)}" />
        </div>
      </div>

      <div class="sectionTitle">Energía</div>
  `;

  if (energia.tipo === "escalones") {
    const escalones = energia.escalones || [];
    html += `
      <div class="muted">Tipo: escalones</div>
      <table>
        <thead>
          <tr>
            <th>Hasta incluye (kWh)</th>
            <th>Precio ($/kWh)</th>
          </tr>
        </thead>
        <tbody>
          ${escalones.map((e, i) => `
            <tr>
              <td>
                <input id="e_hasta_${i}" ${isReadOnly ? "readonly" : ""} value="${e.hastaIncluye === null ? "" : String(e.hastaIncluye)}" placeholder="${i === escalones.length - 1 ? "vacío = sin tope" : ""}" />
              </td>
              <td>
                <input id="e_precio_${i}" ${isReadOnly ? "readonly" : ""} value="${fmtForInput(e.precioPorKWh, 3)}" />
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="muted">Último escalón: dejá “Hasta incluye” vacío para <b>sin tope</b>.</div>
    `;
  } else {
    html += `<div class="error">Este panel todavía no tiene editor para tipo de energía: <b>${escapeHtml(energia.tipo ?? "desconocido")}</b>.</div>`;
  }

  html += `
      <div class="sectionTitle">IVA</div>
      <div class="grid2">
        <div>
          <label>Tasa IVA (ej 0.22)</label>
          <input id="f_iva_tasa" ${isReadOnly ? "readonly" : ""} value="${fmtForInput(iva.tasa ?? 0.22, 2)}" />
        </div>
      </div>

      <div class="grid2">
        <div>
          <label><input type="checkbox" id="iva_cargoFijo" ${aplica.cargoFijo ? "checked" : ""} ${isReadOnly ? "disabled" : ""}/> Cargo fijo grava IVA</label>
          <label><input type="checkbox" id="iva_potencia" ${aplica.potencia ? "checked" : ""} ${isReadOnly ? "disabled" : ""}/> Potencia grava IVA</label>
          <label><input type="checkbox" id="iva_energia" ${aplica.energia ? "checked" : ""} ${isReadOnly ? "disabled" : ""}/> Energía grava IVA</label>
          <label><input type="checkbox" id="iva_reactiva" ${aplica.reactiva ? "checked" : ""} ${isReadOnly ? "disabled" : ""}/> Reactiva grava IVA</label>
        </div>
      </div>

      <div class="actions">
        ${editEnabled ? `
          <button id="btnValidate">Validar</button>
          <button id="btnExport">Exportar tarifas.json</button>
          <button id="btnDiscard">Descartar cambios</button>
        ` : `
          <span class="muted">Para editar necesitás habilitar edición.</span>
        `}
      </div>

    </div>
  `;

  formCard.innerHTML = html;

  if (editEnabled) {
    document.getElementById("btnValidate").addEventListener("click", () => doValidateCurrent());
    document.getElementById("btnExport").addEventListener("click", () => doExport());
    document.getElementById("btnDiscard").addEventListener("click", () => doDiscard());
    hookInputsToData(tarifa.id);
  } else {
    setStatus("", "");
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTarifaById(data, id) {
  return data.tarifas.find(t => t.id === id);
}

function currentTarifa() {
  return getTarifaById(workingDATA, tarifaSelect.value);
}

function hookInputsToData(tarifaId) {
  const t = getTarifaById(workingDATA, tarifaId);
  if (!t) return;

  const byId = (id) => document.getElementById(id);

  function bindText(id, getter, setter) {
    const el = byId(id);
    el.addEventListener("input", () => { setter(el.value); });
  }
  function bindNum(id, decimals, setter) {
    const el = byId(id);
    el.addEventListener("input", () => {
      const v = parseNumberAny(el.value);
      if (Number.isFinite(v)) setter(v);
    });
  }
  function bindCheck(id, setter) {
    const el = byId(id);
    el.addEventListener("change", () => setter(el.checked));
  }

  bindText("f_nombre", () => t.nombre, (v) => t.nombre = v);
  bindText("f_notas", () => t.notas, (v) => t.notas = v);

  bindNum("f_cargoFijo", 2, (v) => t.cargoFijo = v);
  bindNum("f_pot_precio", 1, (v) => {
    t.potencia = t.potencia || {};
    t.potencia.precioPorkW = v;
  });

  // Energía escalones
  if (t.energia?.tipo === "escalones") {
    t.energia.escalones.forEach((esc, i) => {
      const elHasta = document.getElementById(`e_hasta_${i}`);
      const elPrecio = document.getElementById(`e_precio_${i}`);

      elHasta.addEventListener("input", () => {
        const raw = elHasta.value.trim();
        if (raw === "") esc.hastaIncluye = null;
        else {
          const v = parseNumberAny(raw);
          if (Number.isFinite(v)) esc.hastaIncluye = Math.trunc(v);
        }
      });

      elPrecio.addEventListener("input", () => {
        const v = parseNumberAny(elPrecio.value);
        if (Number.isFinite(v)) esc.precioPorKWh = v;
      });
    });
  }

  // IVA
  bindNum("f_iva_tasa", 2, (v) => {
    t.iva = t.iva || {};
    t.iva.tasa = v;
  });
  bindCheck("iva_cargoFijo", (v) => {
    t.iva = t.iva || {};
    t.iva.aplica = t.iva.aplica || {};
    t.iva.aplica.cargoFijo = v;
  });
  bindCheck("iva_potencia", (v) => {
    t.iva = t.iva || {};
    t.iva.aplica = t.iva.aplica || {};
    t.iva.aplica.potencia = v;
  });
  bindCheck("iva_energia", (v) => {
    t.iva = t.iva || {};
    t.iva.aplica = t.iva.aplica || {};
    t.iva.aplica.energia = v;
  });
  bindCheck("iva_reactiva", (v) => {
    t.iva = t.iva || {};
    t.iva.aplica = t.iva.aplica || {};
    t.iva.aplica.reactiva = v;
  });
}

function validateTarifa(t) {
  const errors = [];

  if (!t.nombre || !String(t.nombre).trim()) errors.push("Nombre vacío.");
  if (!Number.isFinite(Number(t.cargoFijo))) errors.push("Cargo fijo inválido.");
  if (!Number.isFinite(Number(t.potencia?.precioPorkW))) errors.push("Precio potencia inválido.");

  if (t.energia?.tipo === "escalones") {
    const esc = t.energia.escalones || [];
    if (esc.length === 0) errors.push("Energía: no hay escalones.");

    // Validar precios y orden de 'hasta'
    let prevHasta = 0;
    for (let i = 0; i < esc.length; i++) {
      const e = esc[i];
      if (!Number.isFinite(Number(e.precioPorKWh))) errors.push(`Escalón ${i+1}: precio inválido.`);
      if (e.hastaIncluye !== null) {
        if (!Number.isFinite(Number(e.hastaIncluye))) errors.push(`Escalón ${i+1}: hasta inválido.`);
        if (Number(e.hastaIncluye) <= prevHasta) errors.push(`Escalón ${i+1}: "hasta" debe ser mayor al anterior.`);
        prevHasta = Number(e.hastaIncluye);
      } else {
        // si es null, debería ser el último
        if (i !== esc.length - 1) errors.push(`Escalón ${i+1}: "sin tope" solo puede estar en el último escalón.`);
      }
    }
  } else {
    errors.push(`Tipo de energía no soportado en editor: ${t.energia?.tipo ?? "desconocido"}.`);
  }

  const tasa = Number(t.iva?.tasa ?? 0.22);
  if (!(tasa >= 0 && tasa <= 1)) errors.push("IVA: tasa debe ser entre 0 y 1 (ej 0.22).");

  return errors;
}

function doValidateCurrent() {
  const t = currentTarifa();
  const errors = validateTarifa(t);
  if (errors.length) setStatus("error", `<b>Errores:</b><br>- ${errors.join("<br>- ")}`);
  else setStatus("ok", "Validación OK ✅");
}

function doDiscard() {
  // vuelve a cargar desde originalDATA (descarta todo)
  workingDATA = deepCopy(originalDATA);
  fillTarifas();
  renderTarifaForm(currentTarifa());
  setStatus("ok", "Cambios descartados. Volviste a la versión cargada desde tarifas.json ✅");
}

function doExport() {
  // Validar todas las tarifas antes de exportar
  const allErrors = [];
  for (const t of workingDATA.tarifas) {
    const errs = validateTarifa(t);
    if (errs.length) allErrors.push(`<b>${escapeHtml(t.id)}</b>: ${errs.join(" | ")}`);
  }
  if (allErrors.length) {
    setStatus("error", `<b>No se puede exportar.</b><br>${allErrors.join("<br>")}`);
    return;
  }

  const blob = new Blob([JSON.stringify(workingDATA, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tarifas.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setStatus("ok", "Exportado ✅ (subí el archivo al repo reemplazando tarifas.json)");
}

function fillTarifas() {
  tarifaSelect.innerHTML = "";
  workingDATA.tarifas.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.id} — ${t.nombre}`;
    tarifaSelect.appendChild(opt);
  });
}

function setEditMode(enabled) {
  editEnabled = enabled;
  modeLabel.textContent = enabled ? "Edición" : "Vista";
  btnEnableEdit.style.display = enabled ? "none" : "inline-block";
  btnDisableEdit.style.display = enabled ? "inline-block" : "none";
  renderTarifaForm(currentTarifa());
}

btnEnableEdit.addEventListener("click", () => {
  const p = prompt("Clave para habilitar edición:");
  if (p === EDIT_PASSWORD) {
    setStatus("ok", "Edición habilitada ✅ (no olvides exportar al terminar)");
    setEditMode(true);
  } else {
    setStatus("error", "Clave incorrecta.");
  }
});

btnDisableEdit.addEventListener("click", () => {
  setEditMode(false);
  setStatus("", "");
});

tarifaSelect.addEventListener("change", () => {
  renderTarifaForm(currentTarifa());
  setStatus("", "");
});

// ---------- Cargar tarifas.json ----------
fetch("./tarifas.json", { cache: "no-store" })
  .then(r => r.json())
  .then(json => {
    originalDATA = json;
    workingDATA = deepCopy(json);
    fillTarifas();
    setEditMode(false);
    renderTarifaForm(currentTarifa());
  })
  .catch(err => {
    console.error(err);
    formCard.innerHTML = `<div class="error">No se pudo cargar tarifas.json</div>`;
  });
