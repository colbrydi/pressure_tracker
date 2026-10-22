// pressure.js

let pressureChart = null;
let changeChart = null;

let currentLat = 42.6928;
let currentLon = -84.4518;
let currentName = "Okemos, MI";
let currentDeltaHours = 24;

let cachedPressure = null;
let cachedTimes = null;
let currentTimeZone = null;

const dataWindowHoursBeta = 48;
const currentWindowHoursBeta = dataWindowHoursBeta / 2;
const resampleIntervalMinutesBeta = 60;
const maxInterpolationGapMinutesBeta = 90;

function hPaToInHg(hPa) {
    return hPa * 0.02953;
}

function hPaToInHgBeta(hPa) {
    return hPa == null || Number.isNaN(hPa) ? null : hPaToInHg(hPa);
}

function formatReadingTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function formatAxisTick(isoString) {
    const d = new Date(isoString);
    const day = d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${day} ${time}`;
}

function formatRangeSubtitle(startIso, endIso) {
    return `${formatReadingTime(startIso)} → ${formatReadingTime(endIso)}`;
}

function getLatestObservedTime(times) {
    const now = Date.now();
    for (let i = times.length - 1; i >= 0; i--) {
        if (new Date(times[i]).getTime() <= now) {
            return times[i];
        }
    }
    return times[times.length - 1];
}

function getDataFreshness(latestIso) {
    const ageHours = (Date.now() - new Date(latestIso).getTime()) / 3600000;

    if (ageHours > 6) {
        return {
            level: "very-stale",
            text: `⚠ Data is ${Math.round(ageHours)} hours old — last reading ${formatReadingTime(latestIso)}`
        };
    }
    if (ageHours > 2) {
        return {
            level: "stale",
            text: `Last reading ${formatReadingTime(latestIso)} (${Math.round(ageHours * 10) / 10}h ago)`
        };
    }
    return {
        level: "fresh",
        text: `Latest reading: ${formatReadingTime(latestIso)}`
    };
}

function buildChartOptions(yScale) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: "index",
            intersect: false
        },
        plugins: {
            tooltip: {
                callbacks: {
                    title: items => formatReadingTime(items[0].label)
                }
            }
        },
        scales: {
            x: {
                title: {
                    display: true,
                    text: "Local time"
                },
                ticks: {
                    maxTicksLimit: 8,
                    maxRotation: 45,
                    minRotation: 0,
                    autoSkip: true,
                    callback: function(value) {
                        return formatAxisTick(this.getLabelForValue(value));
                    }
                }
            },
            y: yScale
        }
    };
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

function getUsStateNameBeta(query) {
    const normalizedQuery = query.trim().toLowerCase();

    if (US_STATE_ABBR[normalizedQuery]) {
        return US_STATE_ABBR[normalizedQuery];
    }

    return Object.values(US_STATE_ABBR).includes(normalizedQuery) ? normalizedQuery : null;
}

async function geocodeSearchBeta(name, countryCode = "") {
    const url =
        `https://geocoding-api.open-meteo.com/v1/search` +
        `?name=${encodeURIComponent(name)}` +
        `&count=10&language=en` +
        (countryCode ? `&countryCode=${encodeURIComponent(countryCode)}` : "");
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(response.statusText);
    }

    return response.json();
}

function getLocationResultScoreBeta(query, result) {
    const parts = query.split(",").map(part => part.trim()).filter(Boolean);
    const cityHint = parts[0].toLowerCase();
    const stateHint = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
    const stateFull = stateHint.length === 2 ? (US_STATE_ABBR[stateHint] || "") : stateHint;
    const stateNameQuery = Boolean(getUsStateNameBeta(cityHint));
    const name = (result.name || "").toLowerCase();
    const admin1 = (result.admin1 || "").toLowerCase();
    const countryCode = (result.country_code || "").toLowerCase();
    let score = 0;

    if (name === cityHint) score += 3;
    else if (name.startsWith(cityHint)) score += 2;

    if (stateNameQuery && admin1 === cityHint) score += 10;

    if (stateHint) {
        if (stateFull && admin1 === stateFull) score += 5;
        else if (admin1 === stateHint || admin1.startsWith(stateHint)) score += 4;
        else if (countryCode === stateHint) score += 3;
    }

    if (stateNameQuery && countryCode === "us") score += 3;

    if (result.feature_code === "PPL" || result.feature_code === "PPLA" || result.feature_code === "PPLC") {
        score += 2;
    }

    if (result.population) score += Math.log10(result.population);

    return score;
}

function getLocationResultLabelBeta(result) {
    return [result.name, result.admin1, result.country].filter(Boolean).join(", ");
}

function clearLocationResultsBeta() {
    document.getElementById("locationResults").replaceChildren();
}

function selectLocationResultBeta(result) {
    currentLat = result.latitude;
    currentLon = result.longitude;
    currentName = formatLocationName(result);

    document.getElementById("location").value = currentName;
    clearLocationResultsBeta();
    updateLocationLabel();
    loadData();
}

function renderLocationResultsBeta(query, results) {
    const container = document.getElementById("locationResults");
    const rankedResults = [...results]
        .sort((a, b) => getLocationResultScoreBeta(query, b) - getLocationResultScoreBeta(query, a))
        .slice(0, 5);

    container.replaceChildren(...rankedResults.map(result => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "location-result";
        button.textContent = getLocationResultLabelBeta(result);
        button.addEventListener("click", () => selectLocationResultBeta(result));
        return button;
    }));
}

async function searchLocationBeta() {
    const location = document.getElementById("location").value.trim();
    if (!location) return;

    try {
        const stateName = getUsStateNameBeta(location);
        let data = await geocodeSearchBeta(location, stateName ? "US" : "");

        if (!data.results || data.results.length === 0) {
            const cityPart = location.split(",")[0].trim();
            if (cityPart && cityPart !== location) {
                data = await geocodeSearchBeta(cityPart);
            }
        }

        if (!data.results || data.results.length === 0) {
            clearLocationResultsBeta();
            alert("Location not found. Try a city name, \"City, State\", or postal code.");
            return;
        }

        if (data.results.length === 1) {
            selectLocationResultBeta(data.results[0]);
            return;
        }

        renderLocationResultsBeta(location, data.results);
    } catch (err) {
        console.error(err);
        alert("Unable to find location.");
    }
}

function useMyLocationBeta() {
    clearLocationResultsBeta();
    useMyLocation();
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
        `&past_hours=${dataWindowHoursBeta}` +
        `&forecast_hours=0` +
        `&timezone=auto` +
        `&timeformat=unixtime`;

    try {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(response.statusText);
        }

        const data = await response.json();

        const rawPressure = data.hourly.pressure_msl || [];
        const rawTimes = data.hourly.time || [];

        if (!data.timezone) {
            throw new Error("The weather service did not return a time zone for this location.");
        }

        cachedPressure = rawPressure.map(hPaToInHgBeta);
        cachedTimes = rawTimes;
        currentTimeZone = data.timezone;

        renderChartsBeta();

    } catch (err) {
        console.error(err);
        alert("Unable to load pressure data.");
    }
}

function onDeltaChange() {
    currentDeltaHours = parseInt(document.getElementById("deltaHours").value, 10);
    document.getElementById("deltaLabel").textContent = `${currentDeltaHours} hr`;
    if (cachedPressure) renderChartsBeta();
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

    updateTimeLabels(timeWindow, hours);

    drawPressureChart(timeWindow, pressureWindow);
    drawChangeChart(timeWindow, changeWindow, hours);
}

function updateTimeLabels(timeWindow, hours) {

    const latestIso = getLatestObservedTime(timeWindow);
    const startIso = timeWindow[0];
    const freshness = getDataFreshness(latestIso);
    const rangeText = formatRangeSubtitle(startIso, latestIso);

    document.getElementById("changeTitle").textContent =
        `${hours}-Hour Pressure Change (inHg)`;
    document.getElementById("changeSubtitle").textContent =
        `Latest: ${formatReadingTime(latestIso)} · Showing last 48 hours`;

    document.getElementById("pressureTitle").textContent = "Pressure (inHg)";
    document.getElementById("pressureSubtitle").textContent =
        `Latest: ${formatReadingTime(latestIso)} · ${rangeText}`;

    const el = document.getElementById("lastUpdated");
    el.textContent = freshness.text;
    el.className = freshness.level === "fresh" ? "" : freshness.level;
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
            options: buildChartOptions({
                min: 28.5,
                max: 30.8,
                title: {
                    display: true,
                    text: "Pressure (inHg)"
                }
            })
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
            options: buildChartOptions({
                min: -0.5,
                max: 0.5,
                title: {
                    display: true,
                    text: "Δ inHg"
                }
            })
        }
    );
}

function parseApiTimeBeta(time) {
    if (typeof time === "number" || (typeof time === "string" && /^\d+(?:\.\d+)?$/.test(time))) {
        return new Date(Number(time) * 1000);
    }

    return new Date(`${time}Z`);
}

function formatReadingTimeBeta(time) {
    return parseApiTimeBeta(time).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: currentTimeZone
    });
}

function formatAxisTickBeta(time) {
    const d = parseApiTimeBeta(time);
    const options = { timeZone: currentTimeZone };
    const day = d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric", ...options });
    const timeLabel = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...options });
    return `${day} ${timeLabel}`;
}

function formatRangeSubtitleBeta(startIso, endIso) {
    return `${formatReadingTimeBeta(startIso)} → ${formatReadingTimeBeta(endIso)}`;
}

function getLatestObservedIndexBeta(times) {
    const now = Date.now();

    for (let i = times.length - 1; i >= 0; i--) {
        if (parseApiTimeBeta(times[i]).getTime() <= now) {
            return i;
        }
    }

    return -1;
}

function getDataFreshnessBeta(latestIso) {
    const ageHours = (Date.now() - parseApiTimeBeta(latestIso).getTime()) / 3600000;

    if (ageHours > 6) {
        return {
            level: "very-stale",
            text: `⚠ Data is ${Math.round(ageHours)} hours old — last reading ${formatReadingTimeBeta(latestIso)}`
        };
    }
    if (ageHours > 2) {
        return {
            level: "stale",
            text: `Last reading ${formatReadingTimeBeta(latestIso)} (${Math.round(ageHours * 10) / 10}h ago)`
        };
    }
    return {
        level: "fresh",
        text: `Latest reading: ${formatReadingTimeBeta(latestIso)}`
    };
}

function buildChartOptionsBeta(yScale) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: "index",
            intersect: false
        },
        plugins: {
            tooltip: {
                callbacks: {
                    title: items => formatReadingTimeBeta(items[0].label)
                }
            }
        },
        scales: {
            x: {
                title: {
                    display: true,
                    text: `Location time (${currentTimeZone})`
                },
                ticks: {
                    maxTicksLimit: 8,
                    maxRotation: 45,
                    minRotation: 0,
                    autoSkip: true,
                    callback: function(value) {
                        return formatAxisTickBeta(this.getLabelForValue(value));
                    }
                }
            },
            y: yScale
        }
    };
}

function updateTimeLabelsBeta(pressureTimes, changeTimes, hours) {
    const latestIso = pressureTimes[pressureTimes.length - 1];
    const startIso = pressureTimes[0];
    const freshness = getDataFreshnessBeta(latestIso);
    const rangeText = formatRangeSubtitleBeta(startIso, latestIso);

    document.getElementById("changeTitle").textContent =
        `${hours}-Hour Pressure Change (inHg)`;
    document.getElementById("changeSubtitle").textContent =
        `Comparing the latest ${currentWindowHoursBeta} hours · Latest: ${formatReadingTimeBeta(changeTimes[changeTimes.length - 1])}`;

    document.getElementById("pressureTitle").textContent = "Pressure (inHg)";
    document.getElementById("pressureSubtitle").textContent =
        `Latest: ${formatReadingTimeBeta(latestIso)} · ${rangeText}`;

    const el = document.getElementById("lastUpdated");
    el.textContent = freshness.text;
    el.className = freshness.level === "fresh" ? "" : freshness.level;
}

function getCurrentWindowStartIndexBeta(times, hours) {
    const latestMs = parseApiTimeBeta(times[times.length - 1]).getTime();
    const windowStartMs = latestMs - hours * 3600000;

    return times.findIndex(time => parseApiTimeBeta(time).getTime() > windowStartMs);
}

function resamplePressureBeta(rawTimes, rawValues) {
    const intervalMs = resampleIntervalMinutesBeta * 60000;
    const maxGapMs = maxInterpolationGapMinutesBeta * 60000;
    const sampleCount = dataWindowHoursBeta * 60 / resampleIntervalMinutesBeta;
    const rawPoints = rawTimes
        .map((time, index) => ({
            timeMs: parseApiTimeBeta(time).getTime(),
            value: rawValues[index]
        }))
        .filter(point => Number.isFinite(point.timeMs) && point.value != null && !Number.isNaN(point.value))
        .sort((a, b) => a.timeMs - b.timeMs);

    if (rawPoints.length === 0) {
        throw new Error("The weather service did not return usable pressure readings.");
    }

    const endTimeMs = rawPoints[rawPoints.length - 1].timeMs;
    const startTimeMs = endTimeMs - (sampleCount - 1) * intervalMs;
    const times = [];
    const values = [];
    let nextRawIndex = 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const sampleTimeMs = startTimeMs + sampleIndex * intervalMs;

        while (nextRawIndex < rawPoints.length && rawPoints[nextRawIndex].timeMs < sampleTimeMs) {
            nextRawIndex++;
        }

        const nextPoint = rawPoints[nextRawIndex];
        const previousPoint = rawPoints[nextRawIndex - 1];

        times.push(sampleTimeMs / 1000);

        if (nextPoint?.timeMs === sampleTimeMs) {
            values.push(nextPoint.value);
        } else if (
            previousPoint &&
            nextPoint &&
            nextPoint.timeMs - previousPoint.timeMs <= maxGapMs
        ) {
            const fraction = (sampleTimeMs - previousPoint.timeMs) /
                (nextPoint.timeMs - previousPoint.timeMs);
            values.push(previousPoint.value + (nextPoint.value - previousPoint.value) * fraction);
        } else {
            values.push(null);
        }
    }

    return { times, values };
}

function calculateChangeVectorBeta(values, times, currentStartIndex, hours) {
    const indexByTimestamp = new Map(
        times.map((time, index) => [parseApiTimeBeta(time).getTime(), index])
    );

    return values.slice(currentStartIndex).map((value, index) => {
        const currentIndex = currentStartIndex + index;
        const comparisonTimeMs = parseApiTimeBeta(times[currentIndex]).getTime() - hours * 3600000;
        const comparisonIndex = indexByTimestamp.get(comparisonTimeMs);
        const previousValue = comparisonIndex === undefined ? null : values[comparisonIndex];

        if (value == null || previousValue == null ||
            Number.isNaN(value) || Number.isNaN(previousValue)) {
            return null;
        }

        return +(value - previousValue).toFixed(4);
    });
}

function drawPressureChartBeta(labels, values) {
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
            options: buildChartOptionsBeta({
                min: 28.5,
                max: 30.8,
                title: {
                    display: true,
                    text: "Pressure (inHg)"
                }
            })
        }
    );
}

function drawChangeChartBeta(labels, values, hours = 12) {
    if (changeChart) changeChart.destroy();

    const { yellow, red } = getRiskThresholds(hours);
    const pointColors = values.map(v => {
        if (v === null || Number.isNaN(v)) return "rgba(0,0,0,0)";

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
            options: buildChartOptionsBeta({
                min: -0.5,
                max: 0.5,
                title: {
                    display: true,
                    text: "Δ inHg"
                }
            })
        }
    );
}

function renderChartsBeta() {
    const lastObservedIndex = getLatestObservedIndexBeta(cachedTimes);

    if (lastObservedIndex < 0) {
        throw new Error("The weather service returned no readings at or before the current time.");
    }

    const observedPressure = cachedPressure.slice(0, lastObservedIndex + 1);
    const observedTimes = cachedTimes.slice(0, lastObservedIndex + 1);
    const { times: pressureTimes, values: pressureWindow } =
        resamplePressureBeta(observedTimes, observedPressure);

    const changeStartIndex = getCurrentWindowStartIndexBeta(pressureTimes, currentWindowHoursBeta);
    if (changeStartIndex < 0) {
        throw new Error("The weather service did not return a complete current comparison window.");
    }

    const changeWindow = calculateChangeVectorBeta(
        pressureWindow,
        pressureTimes,
        changeStartIndex,
        currentDeltaHours
    );
    const changeTimes = pressureTimes.slice(changeStartIndex);
    const displayedPressure = pressureWindow.slice(changeStartIndex);
    const displayedPressureTimes = pressureTimes.slice(changeStartIndex);

    let latestChange = 0;
    for (let i = changeWindow.length - 1; i >= 0; i--) {
        if (changeWindow[i] !== null && !Number.isNaN(changeWindow[i])) {
            latestChange = changeWindow[i];
            break;
        }
    }

    setBackground(getSeverity(latestChange, currentDeltaHours));
    updateTimeLabelsBeta(displayedPressureTimes, changeTimes, currentDeltaHours);
    drawPressureChartBeta(displayedPressureTimes, displayedPressure);
    drawChangeChartBeta(changeTimes, changeWindow, currentDeltaHours);
}

window.addEventListener("load", () => {
    document.body.style.backgroundColor = "#9ef79e";
    updateLocationLabel();

    document.getElementById("location").addEventListener("keydown", e => {
        if (e.key === "Enter") searchLocationBeta();
    });

    loadData();
});
