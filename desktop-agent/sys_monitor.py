"""Real‑time system monitor with a Flask dashboard.

Run the script with:
    python sys_monitor.py

It starts a web server on http://localhost:8080 that serves a simple HTML page.
The page uses Chart.js to display live line charts for CPU usage, RAM usage and
the number of active processes. The browser fetches fresh data every second
from the ``/stats`` endpoint.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Dict

import psutil
from flask import Flask, jsonify, render_template_string

app = Flask(__name__)

# Shared state updated by a background thread
_state: Dict[str, list] = {
    "timestamps": [],  # simple counter for x‑axis
    "cpu": [],
    "ram": [],
    "tasks": [],
}
_state_lock = threading.Lock()


def collect_stats() -> None:
    """Background worker that samples system metrics every second.

    The data is kept in ``_state`` limited to the most recent 60 points so the
    charts stay lightweight.
    """
    counter = 0
    while True:
        cpu = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory().percent
        tasks = len(psutil.pids())
        with _state_lock:
            _state["timestamps"].append(counter)
            _state["cpu"].append(cpu)
            _state["ram"].append(ram)
            _state["tasks"].append(tasks)
            # Keep only the last 60 entries (last minute)
            if len(_state["timestamps"]) > 60:
                for key in _state:
                    _state[key].pop(0)
        counter += 1
        time.sleep(1)


@app.route("/stats")
def stats() -> "flask.Response":
    """Return the latest sampled data as JSON.

    The frontend expects a structure like:
    {
        "timestamps": [...],
        "cpu": [...],
        "ram": [...],
        "tasks": [...]
    }
    """
    with _state_lock:
        data = {
            "timestamps": list(_state["timestamps"]),
            "cpu": list(_state["cpu"]),
            "ram": list(_state["ram"]),
            "tasks": list(_state["tasks"]),
        }
    return jsonify(data)


# Simple HTML page using Chart.js (served directly from a string for brevity)
HTML_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>System Monitor Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {font-family: Arial, sans-serif; margin: 20px; background:#f4f4f4;}
        h1 {text-align:center;}
        .chart-container {width: 90%; margin: auto;}
    </style>
</head>
<body>
    <h1>🖥️ Real‑time System Monitor</h1>
    <div class="chart-container">
        <canvas id="cpuChart"></canvas>
    </div>
    <div class="chart-container">
        <canvas id="ramChart"></canvas>
    </div>
    <div class="chart-container">
        <canvas id="tasksChart"></canvas>
    </div>
    <script>
        const ctxCpu = document.getElementById('cpuChart').getContext('2d');
        const ctxRam = document.getElementById('ramChart').getContext('2d');
        const ctxTasks = document.getElementById('tasksChart').getContext('2d');

        const chartConfig = (label, bgColor, borderColor) => ({
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: label,
                    data: [],
                    backgroundColor: bgColor,
                    borderColor: borderColor,
                    fill: false,
                    tension: 0.1,
                }]
            },
            options: {
                responsive: true,
                animation: false,
                scales: {
                    x: {display: true, title: {display: true, text: 'seconds'}},
                    y: {beginAtZero: true, max: label === 'Active Tasks' ? undefined : 100}
                }
            }
        });

        const cpuChart = new Chart(ctxCpu, chartConfig('CPU %', 'rgba(255,99,132,0.2)', 'rgba(255,99,132,1)'));
        const ramChart = new Chart(ctxRam, chartConfig('RAM %', 'rgba(54,162,235,0.2)', 'rgba(54,162,235,1)'));
        const tasksChart = new Chart(ctxTasks, chartConfig('Active Tasks', 'rgba(255,206,86,0.2)', 'rgba(255,206,86,1)'));

        async function fetchStats() {
            const resp = await fetch('/stats');
            const data = await resp.json();
            // Update charts
            [cpuChart, ramChart, tasksChart].forEach((chart, idx) => {
                const key = ['cpu', 'ram', 'tasks'][idx];
                chart.data.labels = data.timestamps;
                chart.data.datasets[0].data = data[key];
                chart.update();
            });
        }

        // Pull new data every second
        setInterval(fetchStats, 1000);
        // Initial load
        fetchStats();
    </script>
</body>
</html>
"""


@app.route("/")
def index():
    return render_template_string(HTML_TEMPLATE)


if __name__ == "__main__":
    # Start background collector thread
    collector = threading.Thread(target=collect_stats, daemon=True)
    collector.start()
    # Flask's built‑in server is sufficient for a local demo
    app.run(host="0.0.0.0", port=8080, debug=False)
""