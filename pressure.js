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

function calculateChange(values, hours = 12) {
    return values.map((value, index) => {
        if (index < hours) return null;
        return +(value - values[index - hours]).toFixed(2);
    });
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
    startDate.setDate(endDate.getDate() - 30);

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

        // keep only last 24 hours (~24 points if hourly data)
        const WINDOW = 24;

        const startIndex = Math.max(rawPressure.length - WINDOW, 0);

        const pressure = rawPressure
            .slice(startIndex)
            .map(hPaToInHg);

        const times = rawTimes.slice(startIndex);

        const change12 = calculateChange(pressure, 12);

        // ---- CLEAN RISK SIGNAL ----
        const validChanges = change12.filter(v => v !== null && !isNaN(v));

        const maxChange = validChanges.length
            ? Math.max(...validChanges.map(v => Math.abs(v)))
            : 0;

        const severity = getSeverity(maxChange);
        setBackground(severity);

        drawPressureChart(times, pressure);
        drawChangeChart(times, change12);

    } catch (err) {
        console.error(err);
        alert("Unable to load pressure data.");
    }
}

function getSeverity(change12h) {

    const abs = Math.abs(change12h);

    if (abs < 0.08) return "normal";
    if (abs < 0.18) return "yellow";
    return "red";
}

function setBackground(severity) {

    let color = "white";

    if (severity === "yellow") {
        color = "#fff3b0";
    }

    if (severity === "red") {
        color = "#ffb3b3";
    }

    document.body.style.backgroundColor = color;
}

function drawPressureChart(labels, values) {

    if (pressureChart) {
        pressureChart.destroy();
    }

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
                    tension: 0.15
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
                            maxTicksLimit: 8
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

    if (changeChart) {
        changeChart.destroy();
    }

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
                    tension: 0.15
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
                            maxTicksLimit: 8
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