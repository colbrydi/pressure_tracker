// pressure.js

let pressureChart = null;
let changeChart = null;

let currentLat = 42.6928;
let currentLon = -84.4518;
let currentName = "Okemos, MI";

console.log("PRESSURE.JS LOADED");

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
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${currentLat}` +
        `&longitude=${currentLon}` +
        `&hourly=pressure_msl` +
        `&past_days=5` +
        `&forecast_days=1`;

    try {

        console.log("loadData started");
        const response = await fetch(url);
        console.log("response status:", response.status);

        if (!response.ok) {
            throw new Error(response.statusText);
        }

        const data = await response.json();
        console.log("hourly keys:", Object.keys(data.hourly));
        console.log("data received:", data);

        const rawPressure = data.hourly.pressure_msl || [];
        const rawTimes = data.hourly.time || [];
        
        console.log("latest timestamp:", rawTimes[rawTimes.length - 1]);

        console.log(
            "Newest data point:",
            rawTimes[rawTimes.length - 1]
        );

        console.log("rawPressure length:", rawPressure.length);
        console.log("first pressure:", rawPressure[0]);
        console.log("last pressure:", rawPressure[rawPressure.length - 1]);

        console.log("pressure sample:",
            rawPressure.slice(0,5));

        console.log("time sample:",
            rawTimes.slice(0,5));

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

        const latestTime = timeWindow[timeWindow.length - 1];
        //document.getElementById("lastUpdated").textContent = `Latest data: ${latestTime}`;


        // ---- CLEAN RISK SIGNAL (LATEST ONLY, WINDOW-CORRECT) ----

        // use the SAME window you display
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

        console.log("LATEST CHANGE (window):", latestChange);

        const severity = getSeverity(latestChange);
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

function drawChangeChart(labels, values) {

    if (changeChart) {
        changeChart.destroy();
    }

    const pointColors = values.map(v => {

        if (v === null || isNaN(v)) return "rgba(0,0,0,0)";

        const abs = Math.abs(v);

        if (abs >= 0.3) return "#d9534f";   // red
        if (abs >= 0.1) return "#f0ad4e";   // yellow
        return "#5cb85c";                  // green
    });

    changeChart = new Chart(
        document.getElementById("changeChart"),
        {
            type: "line",
            data: {
                labels,
                datasets: [

                    // 1. main line (neutral)
                    {
                        label: "12-Hour Change",
                        data: values,
                        pointRadius: 0,
                        borderWidth: 2,
                        tension: 0.15,
                        spanGaps: true
                    },

                    // 2. colored risk dots (THIS is the key)
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
    loadData();
});
