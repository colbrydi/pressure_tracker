// pressure.js

let pressureChart = null;
let changeChart = null;

let currentLat = 42.7325;
let currentLon = -84.5555;
let currentName = "East Lansing, MI";

function formatDate(date) {
    return date.toISOString().split("T")[0];
}

function hPaToInHg(hPa) {
    return hPa * 0.02953;
}

function updateLocationLabel() {
    document.getElementById("currentLocation").innerHTML =
        `<strong>${currentName}</strong><br>
         ${currentLat.toFixed(4)}, ${currentLon.toFixed(4)}`;
}

/**
 * TRUE 12-hour difference with gaps preserved
 * (IMPORTANT: null keeps Chart.js from drawing fake values)
 */
function calculateChange(values, hours = 12) {

    const result = new Array(values.length).fill(null);

    for (let i = hours; i < values.length; i++) {
        result[i] = +(values[i] - values[i - hours]).toFixed(4);
    }

    return result;
}

async function searchLocation() {

    const location = document.getElementById("location").value.trim();
    if (!location) return;

    const url =
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            alert("Location not found.");
            return;
        }

        const result = data.results[0];

        currentLat = result.latitude;
        currentLon = result.longitude;

        currentName =
            `${result.name}${result.admin1 ? ", " + result.admin1 : ""}`;

        updateLocationLabel();
        loadData();

    } catch (err) {
        console.error(err);
        alert("Unable to find location.");
    }
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

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 5);

    const url =
        `https://archive-api.open-meteo.com/v1/archive` +
        `?latitude=${currentLat}` +
        `&longitude=${currentLon}` +
        `&start_date=${formatDate(startDate)}` +
        `&end_date=${formatDate(endDate)}` +
        `&hourly=surface_pressure`;

    try {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(response.statusText);
        }

        const data = await response.json();

        const rawPressure = data.hourly.surface_pressure || [];
        const rawTimes = data.hourly.time || [];

        // Convert early (clean signal first)
        const pressure = rawPressure.map(hPaToInHg);

        // Build full change series (aligned)
        const change12 = calculateChange(pressure, 12);

        /**
         * IMPORTANT FIX:
         * We slice AFTER computing derivative so alignment stays intact
         */
        const WINDOW = 48;

        const startIndex = Math.max(pressure.length - WINDOW, 0);

        const pressureWindow = pressure.slice(startIndex);
        const changeWindow = change12.slice(startIndex);
        const timeWindow = rawTimes.slice(startIndex);

        // ---- RISK SIGNAL (correct windowed version) ----
        const validChanges = changeWindow.filter(v => v !== null && !isNaN(v));

        const maxChange = validChanges.length
            ? Math.max(...validChanges.map(v => Math.abs(v)))
            : 0;

        const severity = getSeverity(maxChange);
        setBackground(severity);

        drawPressureChart(timeWindow, pressureWindow);
        drawChangeChart(timeWindow, changeWindow);

    } catch (err) {
        console.error(err);
        alert("Unable to load pressure data.");
    }
}

function getSeverity(change12h) {

    const abs = Math.abs(change12h);

    if (abs < 0.10) return "normal";
    if (abs < 0.30) return "yellow";
    return "red";
}

function setBackground(severity) {

    let color = "white";

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

function drawChangeChart(labels, values) {

    if (changeChart) changeChart.destroy();

    changeChart = new Chart(
        document.getElementById("changeChart"),
        {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "12-Hour Change",
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
                        min: -0.50,
                        max: 0.50,
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
    updateLocationLabel();
    loadData();
});