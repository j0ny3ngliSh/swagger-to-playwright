import "./style.css";
import { computeBarHeights, shortDateLabel } from "./daily-stats";
import type { DailyStatsResponse } from "./daily-stats";

const METRIC_LABELS: Record<string, string> = {
  visitors: "Visitors",
  generated: "Generated",
  copied: "Copied",
  suite_downloaded: "Suite downloads",
  thumbs_up: "👍 Thumbs up",
  thumbs_down: "👎 Thumbs down",
  tried_sample: "Tried sample",
  returned: "Returning visitors",
};
const CHART_COLOR = "#2b6cff";
const CHART_HEIGHT_PX = 40;
const BAR_WIDTH_PX = 6;
const BAR_GAP_PX = 2;

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main class="wrap">
    <h1>Daily Stats</h1>
    <p class="tagline">Per-day breakdown of the funnel metrics in <code>/api/stats</code>.</p>
    <p class="subtitle">Unlisted — not linked from the main tool. This view is read-only and never shows subscriber emails or feedback text.</p>

    <div class="card stats-note">
      Per-day tracking only started accumulating once this view shipped. Days before
      that will show <strong>0</strong> across every metric — that's expected, not
      missing data. Numbers will fill in day by day going forward.
    </div>

    <div class="card">
      <label for="days-select">Show last</label>
      <select id="days-select">
        <option value="7">7 days</option>
        <option value="30" selected>30 days</option>
        <option value="90">90 days</option>
      </select>
    </div>

    <div id="status" class="card">Loading…</div>
    <div id="stats-body" hidden></div>
  </main>
`;

const daysSelect = document.querySelector<HTMLSelectElement>("#days-select")!;
const statusBox = document.querySelector<HTMLDivElement>("#status")!;
const statsBody = document.querySelector<HTMLDivElement>("#stats-body")!;

function buildBarChartSvg(dates: string[], values: number[]): string {
  const heights = computeBarHeights(values, CHART_HEIGHT_PX);
  const svgWidth = dates.length * (BAR_WIDTH_PX + BAR_GAP_PX);
  const bars = heights
    .map((h, i) => {
      const isZero = values[i] === 0;
      const barHeight = isZero ? 1 : Math.max(h, 1);
      const y = CHART_HEIGHT_PX - barHeight;
      const opacity = isZero ? 0.15 : 1;
      const x = i * (BAR_WIDTH_PX + BAR_GAP_PX);
      return `<rect x="${x}" y="${y}" width="${BAR_WIDTH_PX}" height="${barHeight}" rx="1" fill="${CHART_COLOR}" opacity="${opacity}"><title>${dates[i]}: ${values[i]}</title></rect>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${svgWidth} ${CHART_HEIGHT_PX}" width="${svgWidth}" height="${CHART_HEIGHT_PX}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Daily trend">${bars}</svg>`;
}

function render(data: DailyStatsResponse) {
  const dates = data.daily.map((row) => String(row.date));

  const tableRows = data.daily
    .map((row) => {
      const cells = data.metrics.map((m) => `<td>${row[m]}</td>`).join("");
      return `<tr><td>${shortDateLabel(String(row.date))}</td>${cells}</tr>`;
    })
    .join("");
  const tableHeader = data.metrics.map((m) => `<th>${METRIC_LABELS[m] ?? m}</th>`).join("");

  const charts = data.metrics
    .map((m) => {
      const values = data.daily.map((row) => Number(row[m] ?? 0));
      const total = values.reduce((a, b) => a + b, 0);
      return `
        <div class="stats-chart-row">
          <div class="stats-chart-label">${METRIC_LABELS[m] ?? m} <span class="stats-chart-total">(${total} total)</span></div>
          <div class="stats-chart-svg-wrap">${buildBarChartSvg(dates, values)}</div>
        </div>
      `;
    })
    .join("");

  statsBody.innerHTML = `
    <div class="card stats-charts">${charts}</div>
    <div class="card stats-table-wrap">
      <table class="stats-table">
        <thead><tr><th>Date</th>${tableHeader}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

async function load() {
  statusBox.hidden = false;
  statusBox.textContent = "Loading…";
  statsBody.hidden = true;
  try {
    const days = daysSelect.value;
    const res = await fetch(`/api/stats-daily?days=${encodeURIComponent(days)}`);
    if (res.status === 429) {
      statusBox.textContent = "Rate limited — please wait a minute and reload.";
      return;
    }
    if (!res.ok) {
      statusBox.textContent = `Couldn't load stats (HTTP ${res.status}).`;
      return;
    }
    const data: DailyStatsResponse = await res.json();
    render(data);
    statusBox.hidden = true;
    statsBody.hidden = false;
  } catch (e: any) {
    statusBox.textContent = `Couldn't load stats: ${e.message ?? e}`;
  }
}

daysSelect.addEventListener("change", load);
load();
