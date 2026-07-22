// pressure.js

let pressureChart = null;
let changeChart = null;

let currentLat = 42.6928;
let currentLon = -84.4518;
let currentName = "Okemos, MI";
let currentDeltaHours = 12;

let cachedPressure = null;
let cachedTimes = null;

function hPaToInHg(hPa) {
    return hPa * 0.02953;
}

function updateLocationLabel() {
    document.getElementById("currentLocation").innerHTML =
        `<strong>${currentName}</strong><br>
         ${currentLat.toFixed(4)}, ${currentLon.toFixed(4)}`;
}

/**
 * Pressure change over N hours, matched by timestamp (not just array index).
 * Returns null where no reliable earlier reading exists.
 */
function calculateChange(values, times, hours = 12) {

    const result = new Array(values.length).fill(null);
    const msPerHour = 3600000;
    const maxDrift = msPerHour * 1.5;

    for (let i = 0; i < values.length; i++) {

        if (values[i] == null || isNaN(values[i])) continue;

        const targetMs = new Date(times[i]).getTime() - hours * msPerHour;

        let bestJ = -1;
        let bestDiff = Infinity;

        for (let j = i - 1; j >= 0 && j >= i - hours - 2; j--) {
            const diff = Math.abs(new Date(times[j]).getTime() - targetMs);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestJ = j;
            }
        }

        if (bestJ >= 0 && bestDiff <= maxDrift && values[bestJ] != null) {
            result[i] = +(values[i] - values[bestJ]).toFixed(4);
        }
    }

    return result;
}

function formatLocationName(result) {
    const parts = [result.name];
    if (result.admin1) parts.push(result.admin1);
    else if (result.country) parts.push(result.country);
    return parts.join(", ");
}

function pickBestResult(query, results) {

    if (results.length === 1) return results[0];

    const parts = query.split(",").map(s => s.trim()).filter(Boolean);
    const stateHint = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
    const cityHint = parts[0].toLowerCase();
    const stateFull = stateHint.length === 2 ? (US_STATE_ABBR[stateHint] || "") : stateHint;

    let best = results[0];
    let bestScore = -1;

    for (const r of results) {
        let score = 0;
        const name = (r.name || "").toLowerCase();
        const admin1 = (r.admin1 || "").toLowerCase();
        const country = (r.country || "").toLowerCase();
        const countryCode = (r.country_code || "").toLowerCase();

        if (name === cityHint) score += 3;
        else if (name.startsWith(cityHint)) score += 2;

        if (stateHint) {
            if (stateFull && admin1 === stateFull) score += 5;
            else if (admin1 === stateHint || admin1.startsWith(stateHint)) score += 4;
            else if (country === stateHint || countryCode === stateHint) score += 3;
        }

        if (r.feature_code === "PPL" || r.feature_code === "PPLA" || r.feature_code === "PPLC") {
            score += 2;
        }

        if (r.population) score += Math.log10(r.population);

        if (score > bestScore) {
            bestScore = score;
            best = r;
        }
    }

    return best;
}

const US_STATE_ABBR = {
    al:"alabama", ak:"alaska", az:"arizona", ar:"arkansas", ca:"california",
    co:"colorado", ct:"connecticut", de:"delaware", fl:"florida", ga:"georgia",
    hi:"hawaii", id:"idaho", il:"illinois", in:"indiana", ia:"iowa",
    ks:"kansas", ky:"kentucky", la:"louisiana", me:"maine", md:"maryland",
    ma:"massachusetts", mi:"michigan", mn:"minnesota", ms:"mississippi", mo:"missouri",
    mt:"montana", ne:"nebraska", nv:"nevada", nh:"new hampshire", nj:"new jersey",
    nm:"new mexico", ny:"new york", nc:"north carolina", nd:"north dakota", oh:"ohio",
    ok:"oklahoma", or:"oregon", pa:"pennsylvania", ri:"rhode island", sc:"south carolina",
    sd:"south dakota", tn:"tennessee", tx:"texas", ut:"utah", vt:"vermont",
    va:"virginia", wa:"washington", wv:"west virginia", wi:"wisconsin", wy:"wyoming",
    dc:"district of columbia"
};

async function searchLocation() {

    const location = document.getElementById("location").value.trim();
    if (!location) return;

    try {
        let data = await geocodeSearch(location);

        // "City, State" often fails as one string — retry with just the city part
        if (!data.results || data.results.length === 0) {
            const cityPart = location.split(",")[0].trim();
            if (cityPart && cityPart !== location) {
                data = await geocodeSearch(cityPart);
            }
        }

        if (!data.results || data.results.length === 0) {
            alert("Location not found. Try a city name, \"City, State\", or postal code.");
            return;
        }

        const result = pickBestResult(location, data.results);

        currentLat = result.latitude;
        currentLon = result.longitude;
        currentName = formatLocationName(result);

        updateLocationLabel();
        loadData();

    } catch (err) {
        console.error(err);
        alert("Unable to find location.");
    }
}

async function geocodeSearch(name) {
    const url =
        `https://geocoding-api.open-meteo.com/v1/search` +
        `?name=${encodeURIComponent(name)}&count=10&language=en`;
    const response = await fetch(url);
    return response.json();
}

function useMyLocation() {

    if (!navigator.geolocation) {
        alert("Geolocation not supported.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {

            currentLat = position.coords.latitude;
            currentLon = position.coords.longitude;

            currentName = "Current Location";

            updateLocationLabel();
            loadData();
        },
        error => {
            console.error(error);
            alert("Unable to determine location.");
        }
    );
}

async function loadData() {

    const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${currentLat}` +
        `&longitude=${currentLon}` +
        `&hourly=pressure_msl` +
        `&past_days=5` +
        `&forecast_days=1`;

    try {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(response.statusText);
        }

        const data = await response.json();

        const rawPressure = data.hourly.pressure_msl || [];
        const rawTimes = data.hourly.time || [];

        cachedPressure = rawPressure.map(hPaToInHg);
        cachedTimes = rawTimes;

        renderCharts();

    } catch (err) {
        console.error(err);
        alert("Unable to load pressure data.");
    }
}

function onDeltaChange() {
    currentDeltaHours = parseInt(document.getElementById("deltaHours").value, 10);
    document.getElementById("deltaLabel").textContent = `${currentDeltaHours} hr`;
    document.getElementById("changeTitle").textContent =
        `${currentDeltaHours}-Hour Pressure Change (inHg)`;
    if (cachedPressure) renderCharts();
}

function renderCharts() {

    const pressure = cachedPressure;
    const rawTimes = cachedTimes;
    const hours = currentDeltaHours;

    const change = calculateChange(pressure, rawTimes, hours);

    const WINDOW = 48;
    const startIndex = Math.max(pressure.length - WINDOW, 0);

    const pressureWindow = pressure.slice(startIndex);
    const changeWindow = change.slice(startIndex);
    const timeWindow = rawTimes.slice(startIndex);

    let latestChange = null;

    for (let i = changeWindow.length - 1; i >= 0; i--) {
        if (changeWindow[i] !== null && !isNaN(changeWindow[i])) {
            latestChange = changeWindow[i];
            break;
        }
    }

    if (latestChange === null) {
        latestChange = 0;
    }

    const severity = getSeverity(latestChange, hours);
    setBackground(severity);

    drawPressureChart(timeWindow, pressureWindow);
    drawChangeChart(timeWindow, changeWindow, hours);
}

function getSeverity(change, hours = 12) {

    const scale = hours / 12;
    const abs = Math.abs(change);

    if (abs < 0.10 * scale) return "normal";
    if (abs < 0.30 * scale) return "yellow";
    return "red";
}

function getRiskThresholds(hours = 12) {
    const scale = hours / 12;
    return { yellow: 0.10 * scale, red: 0.30 * scale };
}

function setBackground(severity) {

    let color = "#9ef79e";

    if (severity === "yellow") color = "#fff3b0";
    if (severity === "red") color = "#ffb3b3";

    document.body.style.backgroundColor = color;
}

function drawPressureChart(labels, values) {

    if (pressureChart) pressureChart.destroy();

    pressureChart = new Chart(
        document.getElementById("pressureChart"),
        {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Pressure (inHg)",
                    data: values,
                    pointRadius: 0,
                    borderWidth: 2,
                    tension: 0.15,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,

                interaction: {
                    mode: "index",
                    intersect: false
                },

                scales: {
                    x: {
                        ticks: {
                            maxTicksLimit: 6,
                            callback: function(value) {
                                const d = new Date(this.getLabelForValue(value));
                                return `${d.getHours().toString().padStart(2, "0")}:00`;
                            }
                        }
                    },
                    y: {
                        min: 28.5,
                        max: 30.8,
                        title: {
                            display: true,
                            text: "Pressure (inHg)"
                        }
                    }
                }
            }
        }
    );
}

function drawChangeChart(labels, values, hours = 12) {

    if (changeChart) {
        changeChart.destroy();
    }

    const { yellow, red } = getRiskThresholds(hours);

    const pointColors = values.map(v => {

        if (v === null || isNaN(v)) return "rgba(0,0,0,0)";

        const abs = Math.abs(v);

        if (abs >= red) return "#d9534f";
        if (abs >= yellow) return "#f0ad4e";
        return "#5cb85c";
    });

    changeChart = new Chart(
        document.getElementById("changeChart"),
        {
            type: "line",
            data: {
                labels,
                datasets: [

                    {
                        label: `${hours}-Hour Change`,
                        data: values,
                        pointRadius: 0,
                        borderWidth: 2,
                        tension: 0.15,
                        spanGaps: true
                    },

                    {
                        label: "Risk Level",
                        data: values,
                        showLine: false,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        backgroundColor: pointColors,
                        borderWidth: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,

                interaction: {
                    mode: "index",
                    intersect: false
                },

                scales: {
                    x: {
                        ticks: {
                            maxTicksLimit: 6,
                            callback: function(value) {
                                const d = new Date(this.getLabelForValue(value));
                                return `${d.getHours().toString().padStart(2, "0")}:00`;
                            }
                        }
                    },
                    y: {
                        min: -0.5,
                        max: 0.5,
                        title: {
                            display: true,
                            text: "Δ inHg"
                        }
                    }
                }
            }
        }
    );
}

window.addEventListener("load", () => {
    document.body.style.backgroundColor = "#9ef79e";
    updateLocationLabel();

    document.getElementById("location").addEventListener("keydown", e => {
        if (e.key === "Enter") searchLocation();
    });

    loadData();
});
