// -----------------------------
// Small helpers
// -----------------------------
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return [...document.querySelectorAll(sel)]; }

function parseNumber(x) {
    if (x === null || x === undefined || x === "") return null;
    const v = Number(x);
    return Number.isFinite(v) ? v : null;
}

function fmt2(x) {
    const v = parseNumber(x);
    return v === null ? "NA" : v.toFixed(2);
}

function fmt3(x) {
    const v = parseNumber(x);
    return v === null ? "NA" : v.toFixed(3);
}

function loadCsv(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            dynamicTyping: false,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data),
            error: (err) => reject(err),
        });
    });
}

// -----------------------------
// Data store
// -----------------------------
const DATA = {
    baseline: null,
    dr3: null,
    dr5: null,
    endo: null,
    bilat: null,
};

// Load everything up front
async function loadAllData() {
    const [baseline, dr3, dr5, endo, bilat] = await Promise.all([
        loadCsv("./data/final_with_forest_area.csv"),
        loadCsv("./data/final_dr3.csv"),
        loadCsv("./data/final_dr5.csv"),
        loadCsv("./data/final_ela_prtp.csv"),
        loadCsv("./data/bilateral_flows_per_ha.csv"),
    ]);

    DATA.baseline = baseline;
    DATA.dr3 = dr3;
    DATA.dr5 = dr5;
    DATA.endo = endo;
    DATA.bilat = bilat;
}

// Common: filter out Total/ATA/GRL
function countryRows(rows) {
    return rows.filter(r => r.iso !== "Total" && r.iso !== "ATA" && r.iso !== "GRL");
}

// -----------------------------
// Part I logic (CSCC choropleth)
// -----------------------------
function computeCsccBins(rows) {
    const edges = [-Infinity, -3, -1, 0, 1, 3, 5, 10, 20, Infinity];
    const labels = ["< -3", "-3 to -1", "-1 to 0", "0 to 1", "1 to 3", "3 to 5", "5 to 10", "10 to 20", "> 20"];
    const colors = ["#214d8d", "#3d7cbd", "#97b9d6", "#fbd7c6", "#f38863", "#f26a44", "#e8452b", "#ce211a", "#a3241d"];
    const colorMap = Object.fromEntries(labels.map((lab, i) => [lab, colors[i]]));

    function binLabel(v) {
        if (v === null) return null;
        for (let i = 0; i < edges.length - 1; i++) {
            if (v > edges[i] && v <= edges[i + 1]) return labels[i];
        }
        return labels[labels.length - 1];
    }

    const filtered = countryRows(rows);

    const mapped = filtered.map(r => {
        const median = parseNumber(r.CSCC_median);
        const q17 = parseNumber(r.CSCC_q17);
        const q83 = parseNumber(r.CSCC_q83);
        const ci = (q17 !== null && q83 !== null) ? `[${q17.toFixed(2)}, ${q83.toFixed(2)}]` : "";
        const bin = binLabel(median);
        return { ...r, _median: median, _ci: ci, _bin: bin };
    });

    return { mapped, labels, colorMap };
}

function updateCsccMetric(rows) {
    const total = rows.find(r => r.iso === "Total");
    if (!total) {
        $("#csccMetric").textContent = "Global CSCC summary not found (missing iso == 'Total').";
        return;
    }

    const med = parseNumber(total.CSCC_median);
    const q17 = parseNumber(total.CSCC_q17);
    const q83 = parseNumber(total.CSCC_q83);

    $("#csccMetric").innerHTML = `
    <strong>Median SCC:</strong>
    <strong>USD ${med?.toFixed(2) ?? "NA"} / tCO₂</strong>
    (66% CI: [${q17?.toFixed(2) ?? "NA"}, ${q83?.toFixed(2) ?? "NA"}])
  `;
}

function renderCategoricalChoropleth({
    divId,
    title,
    rows,
    isoField,
    countryField,
    valueFieldForHover,
    valueFormatFn,
    binField,
    labels,
    colorMap,
    extraHoverFields = [], // [{ key, label, formatFn }]
    missingColor = "lightgrey",
}) {
    const locations = rows.map(r => r[isoField]);

    const hoverText = rows.map(r => {
        const country = r[countryField] ?? r[isoField];
        const val = valueFormatFn(parseNumber(r[valueFieldForHover]));
        let html = `<b>${country}</b><br>${val}`;
        for (const f of extraHoverFields) {
            const raw = r[f.key];
            const formatted = f.formatFn ? f.formatFn(raw) : (raw ?? "");
            html += `<br>${f.label}: ${formatted}`;
        }
        return html + "<extra></extra>";
    });

    const labelToIndex = Object.fromEntries(labels.map((lab, i) => [lab, i]));
    const z = rows.map(r => (r[binField] ? labelToIndex[r[binField]] : null));

    const colorscale = labels.map((lab, i) => {
        const t = labels.length === 1 ? 1 : i / (labels.length - 1);
        return [t, colorMap[lab]];
    });

    const trace = {
        type: "choropleth",
        locationmode: "ISO-3",
        locations,
        z,
        text: hoverText,
        hovertemplate: "%{text}",
        zmin: 0,
        zmax: labels.length - 1,
        colorscale,
        showscale: false,
        marker: { line: { color: "black", width: 0.3 } },
        missingcolor: missingColor,
    };

    const layout = {
        title,
        margin: { l: 0, r: 0, t: 60, b: 0 },
        geo: {
            projection: { type: "natural earth" },
            showland: true,
            landcolor: "lightgrey",
        },
    };

    Plotly.newPlot(divId, [trace], layout, { responsive: true });
}

function renderCsccMap(rows, scenarioLabel) {
    const { mapped, labels, colorMap } = computeCsccBins(rows);

    renderCategoricalChoropleth({
        divId: "plot-part1",
        title: `CSCC median (US$/tCO₂) — ${scenarioLabel} Discounting`,
        rows: mapped,
        isoField: "iso",
        countryField: "Country",
        valueFieldForHover: "CSCC_median",
        valueFormatFn: (v) => `CSCC: ${v === null ? "NA" : v.toFixed(2)}`,
        binField: "_bin",
        labels,
        colorMap,
        extraHoverFields: [
            { key: "_ci", label: "66% CI", formatFn: (x) => x || "" },
        ],
    });
}

// -----------------------------
// Part II logic (Fluxes choropleth)
// -----------------------------
const FLUX_CONFIG = {
    Fa_tf: ["Fa_tf_mean", "Fa_tf_std", "Natural land sink"],
    Fb: ["Fb_mean", "Fb_std", "Land-use change emissions"],
    Fc: ["Fc_mean", "Fc_std", "Fossil fuel emissions"],
    Fab_tf: ["Fab_tf_mean", "Fab_tf_std", "Net land flux"],
    Fabc_tf: ["Fabc_tf_mean", "Fabc_tf_std", "Net total flux"],
};

function computeFluxBins(rows, meanCol) {
    const edges = [-Infinity, -0.1, -0.01, 0, 0.01, 0.1, 0.3, 0.5, 1, Infinity];
    const labels = ["< -0.1", "-0.1 to -0.01", "-0.01 to 0", "0 to 0.01", "0.01 to 0.1", "0.1 to 0.3", "0.3 to 0.5", "0.5 to 1", "> 1"];

    const binColors = [
        "#116535",
        "#66bd63",
        "#a6d96a",
        "#ffe8a8",
        "#ffd27a",
        "#fdae61",
        "#f46d43",
        "#d73027",
        "#a3241d",
    ];

    const colorMap = Object.fromEntries(labels.map((lab, i) => [lab, binColors[i]]));

    function binLabel(v) {
        if (v === null) return null;
        for (let i = 0; i < edges.length - 1; i++) {
            if (v > edges[i] && v <= edges[i + 1]) return labels[i];
        }
        return labels[labels.length - 1];
    }

    const filtered = countryRows(rows);

    const mapped = filtered.map(r => {
        const mean = parseNumber(r[meanCol]);
        const bin = binLabel(mean);
        return { ...r, _mean: mean, _bin: bin };
    });

    return { mapped, labels, colorMap };
}

function renderFluxMap(rows, fluxKey) {
    const cfg = FLUX_CONFIG[fluxKey];
    if (!cfg) return;
    const [meanCol, stdCol, fluxLabel] = cfg;
    const { mapped, labels, colorMap } = computeFluxBins(rows, meanCol);

    renderCategoricalChoropleth({
        divId: "plot-part2",
        title: `${fluxLabel} (GtC/yr)`,
        rows: mapped,
        isoField: "iso",
        countryField: "Country",
        valueFieldForHover: meanCol,
        valueFormatFn: (v) => `${fluxLabel}: ${v === null ? "NA" : v.toFixed(3)} GtC/yr`,
        binField: "_bin",
        labels,
        colorMap,
        extraHoverFields: [
            { key: stdCol, label: "Std Dev (GtC/yr)", formatFn: (x) => fmt3(x) },
        ],
    });
}

// -----------------------------
// Part III logic (CCI choropleth)
// -----------------------------
const CCI_FLUX_PREFIX = {
    Fa_tf: "Natural land sink",
    Fb: "Land-use change emissions",
    Fc: "Fossil fuel emissions",
    Fab_tf: "Net land flux",
    Fabc_tf: "Net total flux",
};

const CCI_MEASURES = {
    Wglob: "Global CCI",
    Wdom: "Domestic CCI",
    Wout: "Outbound CCI",
    Win: "Inbound CCI",
    Wnet: "Balance of Transboundary CCI",
};

function computeCciBins(rows, medianCol, q17Col, q83Col) {
    const edges = [-Infinity, -100, -50, -20, -10, -1, 0, 1, 10, 20, 50, 100, Infinity];
    const labels = ["< -100", "-100 to -50", "-50 to -20", "-20 to -10", "-10 to -1", "-1 to 0",
        "0 to 1", "1 to 10", "10 to 20", "20 to 50", "50 to 100", "> 100"];

    const binColors = [
        "#a3241d",
        "#ce211a",
        "#e8452b",
        "#f26a44",
        "#f38863",
        "#fbd7c6",
        "#c5d8e8",
        "#72aad6",
        "#4681c0",
        "#255596",
        "#163e75",
        "#10306d",
    ];

    const colorMap = Object.fromEntries(labels.map((lab, i) => [lab, binColors[i]]));

    function binLabel(v) {
        if (v === null) return null;
        for (let i = 0; i < edges.length - 1; i++) {
            if (v > edges[i] && v <= edges[i + 1]) return labels[i];
        }
        return labels[labels.length - 1];
    }

    const filtered = countryRows(rows);

    const mapped = filtered.map(r => {
        const med = parseNumber(r[medianCol]);
        const q17 = parseNumber(r[q17Col]);
        const q83 = parseNumber(r[q83Col]);
        const ci = (q17 !== null && q83 !== null) ? `[${q17.toFixed(2)}, ${q83.toFixed(2)}]` : "";
        const bin = binLabel(med);
        return { ...r, _med: med, _ci: ci, _bin: bin };
    });

    return { mapped, labels, colorMap };
}

function renderCciMap(rows, fluxKey, measureKey) {
    const fluxLabel = CCI_FLUX_PREFIX[fluxKey] ?? fluxKey;
    const measureLabel = CCI_MEASURES[measureKey] ?? measureKey;

    const medianCol = `${fluxKey}_${measureKey}_median`;
    const q17Col = `${fluxKey}_${measureKey}_q17`;
    const q83Col = `${fluxKey}_${measureKey}_q83`;

    const { mapped, labels, colorMap } = computeCciBins(rows, medianCol, q17Col, q83Col);

    renderCategoricalChoropleth({
        divId: "plot-part3",
        title: `${fluxLabel} — ${measureLabel} (US$ billion/yr)`,
        rows: mapped,
        isoField: "iso",
        countryField: "Country",
        valueFieldForHover: medianCol,
        valueFormatFn: (v) => `${measureLabel}: ${v === null ? "NA" : v.toFixed(2)} US$ bn/yr`,
        binField: "_bin",
        labels,
        colorMap,
        extraHoverFields: [
            { key: "_ci", label: "66% CI", formatFn: (x) => x || "" },
        ],
    });
}

// -----------------------------
// Part IV logic (Per ha metrics + bilateral map)
// -----------------------------
function buildPerHaLookup(baselineRows) {
    // Create per-ha medians for Fa_tf_W* based on Forest_ha
    const rows = countryRows(baselineRows);
    const out = new Map(); // iso -> {Wglob, Wdom, Wout, Win, Wnet, and CI}

    for (const r of rows) {
        const forestHa = parseNumber(r.Forest_ha);
        if (!forestHa || forestHa <= 0) continue;

        function perHa(col) {
            const v = parseNumber(r[col]);
            if (v === null) return null;
            // Streamlit: (value / Forest_ha) * 1e9
            return (v / forestHa) * 1e9;
        }

        const obj = {
            Country: r.Country ?? r.iso,
            iso: r.iso,
            Forest_ha: forestHa,

            Wglob_median: perHa("Fa_tf_Wglob_median"),
            Wdom_median: perHa("Fa_tf_Wdom_median"),
            Wout_median: perHa("Fa_tf_Wout_median"),
            Win_median: perHa("Fa_tf_Win_median"),
            Wnet_median: perHa("Fa_tf_Wnet_median"),

            Wglob_q17: perHa("Fa_tf_Wglob_q17"),
            Wglob_q83: perHa("Fa_tf_Wglob_q83"),
            Wdom_q17: perHa("Fa_tf_Wdom_q17"),
            Wdom_q83: perHa("Fa_tf_Wdom_q83"),
            Wout_q17: perHa("Fa_tf_Wout_q17"),
            Wout_q83: perHa("Fa_tf_Wout_q83"),
            Win_q17: perHa("Fa_tf_Win_q17"),
            Win_q83: perHa("Fa_tf_Win_q83"),
            Wnet_q17: perHa("Fa_tf_Wnet_q17"),
            Wnet_q83: perHa("Fa_tf_Wnet_q83"),
        };

        out.set(r.iso, obj);
    }

    return out;
}

function populateSinkDropdown(bilatRows) {
    const sel = $("#sinkCountrySelect");
    if (!sel) return;

    // Unique sink options
    const seen = new Map(); // iso -> name
    for (const r of bilatRows) {
        const iso = r.sink_iso;
        const name = r.sink_country;
        if (!iso || !name) continue;
        if (!seen.has(iso)) seen.set(iso, name);
    }

    const options = [...seen.entries()]
        .map(([iso, name]) => ({ iso, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    sel.innerHTML = "";
    for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.iso;
        o.textContent = opt.name;
        sel.appendChild(o);
    }

    return options;
}

function updatePerHaMetrics(perHaLookup, sinkIso) {
    const row = perHaLookup.get(sinkIso);
    if (!row) {
        $("#mGlob").textContent = "—";
        $("#mDom").textContent = "—";
        $("#mOut").textContent = "—";
        $("#mIn").textContent = "—";
        $("#mNet").textContent = "—";
        return;
    }

    $("#mGlob").textContent = row.Wglob_median === null ? "NA" : row.Wglob_median.toFixed(2);
    $("#mDom").textContent = row.Wdom_median === null ? "NA" : row.Wdom_median.toFixed(2);
    $("#mOut").textContent = row.Wout_median === null ? "NA" : row.Wout_median.toFixed(2);
    $("#mIn").textContent = row.Win_median === null ? "NA" : row.Win_median.toFixed(2);
    $("#mNet").textContent = row.Wnet_median === null ? "NA" : row.Wnet_median.toFixed(2);
}

function updateCiTable(perHaLookup, sinkIso) {
    const table = $("#ciTable");
    if (!table) return;

    const tbody = table.querySelector("tbody");
    const row = perHaLookup.get(sinkIso);

    if (!row) {
        tbody.innerHTML = `<tr><td colspan="3" class="muted">Select a sink country to populate this table.</td></tr>`;
        return;
    }

    function ci(q17, q83) {
        const a = parseNumber(q17);
        const b = parseNumber(q83);
        if (a === null || b === null) return "";
        return `[${a.toFixed(2)}, ${b.toFixed(2)}]`;
    }

    const items = [
        ["Global CCI", row.Wglob_median, ci(row.Wglob_q17, row.Wglob_q83)],
        ["Domestic CCI", row.Wdom_median, ci(row.Wdom_q17, row.Wdom_q83)],
        ["Outbound CCI", row.Wout_median, ci(row.Wout_q17, row.Wout_q83)],
        ["Inbound CCI", row.Win_median, ci(row.Win_q17, row.Win_q83)],
        ["Balance (Outbound − Inbound)", row.Wnet_median, ci(row.Wnet_q17, row.Wnet_q83)],
    ];

    tbody.innerHTML = items.map(([name, med, ciStr]) => `
    <tr>
      <td>${name}</td>
      <td>${med === null ? "NA" : med.toFixed(2)}</td>
      <td>${ciStr}</td>
    </tr>
  `).join("");
}

function renderBilateralMap(baselineRows, bilatRows, sinkIso) {
    const base = countryRows(baselineRows).map(r => ({
        iso: r.iso,
        Country: r.Country ?? r.iso,
    }));

    const sub = bilatRows.filter(r => r.sink_iso === sinkIso);

    // Build lookup: target_iso -> flow info
    const flowByTarget = new Map();
    for (const r of sub) {
        flowByTarget.set(r.target_iso, {
            mean: parseNumber(r.flow_per_ha_mean),
            q17: parseNumber(r.flow_per_ha_q17),
            q83: parseNumber(r.flow_per_ha_q83),
        });
    }

    // Sink display name and forest area
    const sinkName = sub[0]?.sink_country ?? sinkIso;
    const forestHa = parseNumber(sub[0]?.forest_ha);
    const forestMha = (forestHa && forestHa > 0) ? (forestHa / 1e6) : null;

    // Assemble map rows
    const mapRows = base.map(r => {
        const f = flowByTarget.get(r.iso);

        const ci =
            (f && f.q17 !== null && f.q17 !== undefined && f.q83 !== null && f.q83 !== undefined)
                ? `[${f.q17.toFixed(2)}, ${f.q83.toFixed(2)}]`
                : "";

        return {
            ...r,
            flow_mean: f ? f.mean : null,
            flow_ci: ci,
            is_sink: r.iso === sinkIso,
        };
    });


    // Binning like Streamlit Part IV
    const edges = [0, 0.1, 0.5, 1, 3, 10, 30, 100, 300, Infinity];
    const labels = ["0–0.1", "0.1–0.5", "0.5–1", "1–3", "3–10", "10–30", "30–100", "100–300", ">300"];
    const binColors = ["#eef4fb", "#d6e6f6", "#bcd7ee", "#9ecae1", "#72aad6", "#4681c0", "#255596", "#163e75", "#10306d"];
    const colorMap = Object.fromEntries(labels.map((lab, i) => [lab, binColors[i]]));

    function binLabel(v) {
        if (v === null) return null;
        // Include_lowest=True, right=True
        for (let i = 0; i < edges.length - 1; i++) {
            const left = edges[i];
            const right = edges[i + 1];
            const isFirst = i === 0;
            const inBin = isFirst ? (v >= left && v <= right) : (v > left && v <= right);
            if (inBin) return labels[i];
        }
        return labels[labels.length - 1];
    }

    mapRows.forEach(r => { r._bin = binLabel(r.flow_mean); });

    // Main categorical choropleth
    const labelToIndex = Object.fromEntries(labels.map((lab, i) => [lab, i]));
    const z = mapRows.map(r => (r._bin ? labelToIndex[r._bin] : null));
    const colorscale = labels.map((lab, i) => {
        const t = labels.length === 1 ? 1 : i / (labels.length - 1);
        return [t, colorMap[lab]];
    });

    const hoverText = mapRows.map(r => {
        const mean = r.flow_mean === null ? "NA" : r.flow_mean.toFixed(2);
        return `<b>${r.Country}</b><br>US$/ha/yr: ${mean}<br>66% CI: ${r.flow_ci}<extra></extra>`;
    });

    const mainTrace = {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: mapRows.map(r => r.iso),
        z,
        text: hoverText,
        hovertemplate: "%{text}",
        zmin: 0,
        zmax: labels.length - 1,
        colorscale,
        showscale: false,
        marker: { line: { color: "black", width: 0.3 } },
        missingcolor: "lightgrey",
    };

    // Overlay sink outline (red border)
    const sinkTrace = {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: [sinkIso],
        z: [0],
        colorscale: [[0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0)"]],
        showscale: false,
        showlegend: false,
        marker: { line: { color: "red", width: 3 } },
        hovertemplate: `<b>${sinkName}</b><br>Forest area: ${forestMha === null ? "NA" : forestMha.toFixed(2)} Mha<extra></extra>`,
    };

    const layout = {
        title: `Bilateral CCI flows per hectare to ${sinkName}'s Natural Land Sink (US$/ha/yr)`,
        margin: { l: 0, r: 0, t: 60, b: 0 },
        geo: {
            projection: { type: "natural earth" },
            showland: true,
            landcolor: "lightgrey",
        },
    };

    Plotly.newPlot("plot-part4", [mainTrace, sinkTrace], layout, { responsive: true });
}

// -----------------------------
// Navigation + sidebar panels
// -----------------------------
function setActiveSection(id) {
    // main sections
    $all(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.section === id));
    $all(".section").forEach(s => s.classList.toggle("active", s.id === id));

    // sidebar panels
    const panels = ["panel-part1", "panel-part2", "panel-part3", "panel-part4"];
    for (const pid of panels) {
        const el = document.getElementById(pid);
        if (!el) continue;
        el.style.display = (pid === `panel-${id}`) ? "grid" : "none";
    }
}

function getScenarioKey() {
    const v = document.querySelector('input[name="csccScenario"]:checked')?.value;
    return v || "baseline";
}

function scenarioLabelFromKey(k) {
    return ({
        baseline: "2.5% (baseline)",
        dr3: "3%",
        dr5: "5%",
        endo: "Endogenous"
    })[k] ?? k;
}

// -----------------------------
// Init / wiring
// -----------------------------
async function init() {
    await loadAllData();

    // Navigation clicks
    $all(".navbtn").forEach(btn => {
        btn.addEventListener("click", () => {
            setActiveSection(btn.dataset.section);
            // Ensure plotly resizes when switching tabs
            requestAnimationFrame(() => {
                if (btn.dataset.section === "part1") Plotly.Plots.resize("plot-part1");
                if (btn.dataset.section === "part2") Plotly.Plots.resize("plot-part2");
                if (btn.dataset.section === "part3") Plotly.Plots.resize("plot-part3");
                if (btn.dataset.section === "part4") Plotly.Plots.resize("plot-part4");
            });
        });
    });


    // -----------------------------
    // Part I wiring
    // -----------------------------
    $all('input[name="csccScenario"]').forEach(r => {
        r.addEventListener("change", () => {
            const key = getScenarioKey();
            updateCsccMetric(DATA[key]);
            renderCsccMap(DATA[key], scenarioLabelFromKey(key));
        });
    });

    // -----------------------------
    // Part II wiring
    // -----------------------------
    const fluxSelect = $("#fluxSelect");
    if (fluxSelect) {
        fluxSelect.addEventListener("change", () => {
            renderFluxMap(DATA.baseline, fluxSelect.value);
        });
    }

    // -----------------------------
    // Part III wiring
    // -----------------------------
    const cciFluxSelect = $("#cciFluxSelect");
    const cciMeasureSelect = $("#cciMeasureSelect");
    const cciHint = $("#cciInterpretationHint");

    function refreshCci() {
        const fluxKey = cciFluxSelect?.value ?? "Fa_tf";
        const measureKey = cciMeasureSelect?.value ?? "Wglob";

        // Show hint only for Wnet (matches Streamlit caption behavior)
        if (cciHint) cciHint.style.display = (measureKey === "Wnet") ? "block" : "none";

        renderCciMap(DATA.baseline, fluxKey, measureKey);
    }

    if (cciFluxSelect) cciFluxSelect.addEventListener("change", refreshCci);
    if (cciMeasureSelect) cciMeasureSelect.addEventListener("change", refreshCci);

    // -----------------------------
    // Part IV wiring
    // -----------------------------
    const perHaLookup = buildPerHaLookup(DATA.baseline);
    const sinkSelect = $("#sinkCountrySelect");
    const sinkOptions = populateSinkDropdown(DATA.bilat) ?? [];

    function refreshPartIV() {
        const sinkIso = sinkSelect?.value;
        if (!sinkIso) return;

        updatePerHaMetrics(perHaLookup, sinkIso);
        updateCiTable(perHaLookup, sinkIso);
        renderBilateralMap(DATA.baseline, DATA.bilat, sinkIso);
    }

    if (sinkSelect) {
        sinkSelect.addEventListener("change", refreshPartIV);
        // pick first sink by default
        if (sinkOptions.length > 0) {
            sinkSelect.value = sinkOptions[0].iso;
        }
    }

    // -----------------------------
    // Initial renders
    // -----------------------------
    // Show Part I panel initially
    setActiveSection("part1");

    // Part I
    const key = getScenarioKey();
    updateCsccMetric(DATA[key]);
    renderCsccMap(DATA[key], scenarioLabelFromKey(key));

    // Part II
    if (fluxSelect) {
        if (!fluxSelect.value) fluxSelect.value = "Fa_tf";
        renderFluxMap(DATA.baseline, fluxSelect.value);
    }

    // Part III
    refreshCci();

    // Part IV
    refreshPartIV();
}

init().catch(err => {
    console.error(err);
    const m = $("#csccMetric");
    if (m) m.textContent = "Failed to load data. Open the console for details.";
});
