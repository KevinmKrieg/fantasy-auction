const SAMPLE_CSV = `player_name,team,position,projected_points,ceiling_points
Josh Allen,BUF,QB,379.6,438.1
Jalen Hurts,PHI,QB,360.4,425.3
Lamar Jackson,BAL,QB,355.7,432.4
Christian McCaffrey,SF,RB,286.8,351.7
Bijan Robinson,ATL,RB,274.3,338.4
Breece Hall,NYJ,RB,259.1,326.8
CeeDee Lamb,DAL,WR,292.7,355.9
Tyreek Hill,MIA,WR,288.9,366.5
Ja'Marr Chase,CIN,WR,274.4,347.8
Amon-Ra St. Brown,DET,WR,266.8,330.1
Justin Jefferson,MIN,WR,264.6,346.4
Sam LaPorta,DET,TE,219.1,270.8
Travis Kelce,KC,TE,212.5,261.3
Trey McBride,ARI,TE,194.7,246.2
Jake Elliott,PHI,K,145.8,168.2
Brandon Aubrey,DAL,K,144.7,167.5
Jets,NYJ,DST,128.4,154.6
Ravens,BAL,DST,126.3,149.1`;

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DST"];
const POSITION_SET = new Set(POSITION_ORDER);

const state = {
  rawRows: [],
  headers: [],
  allPlayers: [],
  valuedPlayers: [],
  draftedPlayers: new Map(),
};

const elements = {
  csvFile: document.getElementById("csvFile"),
  loadSampleBtn: document.getElementById("loadSampleBtn"),
  uploadStatus: document.getElementById("uploadStatus"),
  runValuationBtn: document.getElementById("runValuationBtn"),
  nameColumn: document.getElementById("nameColumn"),
  teamColumn: document.getElementById("teamColumn"),
  positionColumn: document.getElementById("positionColumn"),
  expectedColumn: document.getElementById("expectedColumn"),
  ceilingColumn: document.getElementById("ceilingColumn"),
  targetColumn: document.getElementById("targetColumn"),
  nameFilter: document.getElementById("nameFilter"),
  teamFilter: document.getElementById("teamFilter"),
  positionFilter: document.getElementById("positionFilter"),
  playersLoaded: document.getElementById("playersLoaded"),
  playersRemaining: document.getElementById("playersRemaining"),
  playersDrafted: document.getElementById("playersDrafted"),
  totalRosterSpots: document.getElementById("totalRosterSpots"),
  leagueBudget: document.getElementById("leagueBudget"),
  auctionPool: document.getElementById("auctionPool"),
  trackedSpend: document.getElementById("trackedSpend"),
  resultsBody: document.getElementById("resultsBody"),
  draftedBody: document.getElementById("draftedBody"),
};

const settingIds = [
  "teams",
  "budget",
  "qbSlots",
  "rbSlots",
  "wrSlots",
  "teSlots",
  "flexSlots",
  "superflexSlots",
  "kSlots",
  "dstSlots",
  "benchSlots",
];

initialize();

function initialize() {
  elements.csvFile.addEventListener("change", handleFileUpload);
  elements.loadSampleBtn.addEventListener("click", () => loadCsvText(SAMPLE_CSV, "sample-projections.csv"));
  elements.runValuationBtn.addEventListener("click", runValuation);
  elements.nameFilter.addEventListener("input", renderResults);
  elements.teamFilter.addEventListener("input", renderResults);
  elements.positionFilter.addEventListener("change", renderResults);
  elements.resultsBody.addEventListener("click", handleResultsClick);
  elements.draftedBody.addEventListener("click", handleDraftedClick);

  for (const id of settingIds) {
    document.getElementById(id).addEventListener("input", rerunIfReady);
  }

  populateSelect(elements.positionFilter, [{ value: "", label: "All" }]);
}

function handleFileUpload(event) {
  const [file] = event.target.files || [];

  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => loadCsvText(String(reader.result || ""), file.name);
  reader.readAsText(file);
}

function loadCsvText(csvText, label) {
  const parsed = parseCsv(csvText);

  if (!parsed.headers.length || !parsed.rows.length) {
    setStatus("Unable to read CSV data. Confirm the file has a header row and at least one player row.");
    return;
  }

  state.rawRows = parsed.rows;
  state.headers = parsed.headers;
  state.allPlayers = [];
  state.valuedPlayers = [];
  state.draftedPlayers = new Map();
  setStatus(`Loaded ${parsed.rows.length} players from ${label}.`, true);
  populateColumnMappings(parsed.headers);
  runValuation();
}

function populateColumnMappings(headers) {
  const headerOptions = headers.map((header) => ({ value: header, label: header }));
  const optionalHeaderOptions = [{ value: "", label: "None" }, ...headerOptions];

  populateSelect(elements.nameColumn, headerOptions);
  populateSelect(elements.teamColumn, headerOptions);
  populateSelect(elements.positionColumn, headerOptions);
  populateSelect(elements.expectedColumn, headerOptions);
  populateSelect(elements.ceilingColumn, headerOptions);
  populateSelect(elements.targetColumn, optionalHeaderOptions);

  setSelectValue(elements.nameColumn, findHeader(headers, ["player", "name"]));
  setSelectValue(elements.teamColumn, findHeader(headers, ["team"]));
  setSelectValue(elements.positionColumn, findHeader(headers, ["position", "pos"]));
  setSelectValue(elements.expectedColumn, findHeader(headers, ["projected_points", "fantasy_points", "points", "fpts", "projection"]));
  setSelectValue(elements.ceilingColumn, findHeader(headers, ["ceiling_points", "ceiling", "high", "p90", "upside"]));
  setSelectValue(elements.targetColumn, findHeader(headers, ["target", "target_price", "target$", "auction_value", "value"]));
}

function runValuation() {
  if (!state.rawRows.length) {
    renderEmpty("Upload a CSV and run valuation to populate the board.");
    updateSummary(0, 0, getSettings(), 0);
    renderDraftedPlayers();
    return;
  }

  const mapping = getColumnMapping();

  if (Object.values(mapping).some((value) => !value)) {
    setStatus("Map all required columns before running valuation.");
    return;
  }

  const allPlayers = state.rawRows
    .map((row, index) => normalizePlayer(row, mapping, index))
    .filter((player) => player && POSITION_SET.has(player.position));

  state.allPlayers = allPlayers;

  if (!allPlayers.length) {
    setStatus("No usable players found after applying the selected column mapping.");
    renderEmpty("No players matched the required fields.");
    renderDraftedPlayers();
    return;
  }

  const players = allPlayers.filter((player) => !state.draftedPlayers.has(player.id));

  const settings = getSettings();
  const expectedAuction = buildAuctionValues(players, "expectedPoints", settings);
  const ceilingAuction = buildAuctionValues(players, "ceilingPoints", settings);

  state.valuedPlayers = players
    .map((player) => {
      const expected = expectedAuction.valuesById.get(player.id) || 1;
      const ceiling = ceilingAuction.valuesById.get(player.id) || 1;

      return {
        ...player,
        expectedPrice: expected,
        ceilingPrice: ceiling,
        rangeLabel: `$${expected.toFixed(0)} - $${ceiling.toFixed(0)}`,
      };
    })
    .sort((left, right) => {
      if (right.ceilingPrice !== left.ceilingPrice) {
        return right.ceilingPrice - left.ceilingPrice;
      }
      return right.expectedPrice - left.expectedPrice;
    });

  updatePositionFilter(state.valuedPlayers);
  updateSummary(allPlayers.length, players.length, settings, expectedAuction.auctionableBudget);
  renderResults();
  renderDraftedPlayers();
  setStatus(`Valuation complete for ${players.length} remaining players.`, true);
}

function normalizePlayer(row, mapping, index) {
  const name = String(row[mapping.name] || "").trim();
  const team = String(row[mapping.team] || "").trim().toUpperCase();
  const rawPosition = String(row[mapping.position] || "").trim().toUpperCase();
  const position = rawPosition === "DEF" ? "DST" : rawPosition;
  const expectedPoints = parseNumeric(row[mapping.expectedPoints]);
  const ceilingPoints = parseNumeric(row[mapping.ceilingPoints]);
  const targetPrice = mapping.targetPrice ? parseOptionalNumeric(row[mapping.targetPrice]) : null;

  if (!name || !position || Number.isNaN(expectedPoints) || Number.isNaN(ceilingPoints)) {
    return null;
  }

  return {
    id: `${name}-${team}-${position}-${index}`,
    name,
    team: team || "-",
    position,
    expectedPoints,
    ceilingPoints,
    targetPrice,
  };
}

function buildAuctionValues(players, metricKey, settings) {
  const draftPlan = simulateDraftPlan(players, metricKey, settings);
  const replacementByPosition = new Map();
  const draftedPlayers = new Set(draftPlan.draftedIds);

  for (const position of POSITION_ORDER) {
    const draftedAtPosition = players
      .filter((player) => player.position === position && draftedPlayers.has(player.id))
      .sort((left, right) => right[metricKey] - left[metricKey]);
    const replacement = draftedAtPosition.length
      ? draftedAtPosition[draftedAtPosition.length - 1][metricKey]
      : 0;
    replacementByPosition.set(position, replacement);
  }

  const valueScores = players.map((player) => {
    const replacement = replacementByPosition.get(player.position) || 0;
    const aboveReplacement = Math.max(0, player[metricKey] - replacement);

    return {
      id: player.id,
      aboveReplacement,
    };
  });

  const rosterSpots = draftPlan.totalRosterSpots;
  const leagueBudget = settings.teams * settings.budget;
  const auctionableBudget = Math.max(0, leagueBudget - rosterSpots);
  const scoreTotal = valueScores.reduce((sum, player) => sum + player.aboveReplacement, 0);
  const valuesById = new Map();

  for (const player of valueScores) {
    const bonus = scoreTotal > 0 ? (player.aboveReplacement / scoreTotal) * auctionableBudget : 0;
    valuesById.set(player.id, roundMoney(1 + bonus));
  }

  return {
    valuesById,
    auctionableBudget,
  };
}

function simulateDraftPlan(players, metricKey, settings) {
  const selectedIds = new Set();
  const playersByPosition = new Map();

  for (const position of POSITION_ORDER) {
    playersByPosition.set(
      position,
      players
        .filter((player) => player.position === position)
        .sort((left, right) => right[metricKey] - left[metricKey])
    );
  }

  selectTop(playersByPosition.get("QB"), settings.teams * settings.qbSlots, selectedIds);
  selectTop(playersByPosition.get("RB"), settings.teams * settings.rbSlots, selectedIds);
  selectTop(playersByPosition.get("WR"), settings.teams * settings.wrSlots, selectedIds);
  selectTop(playersByPosition.get("TE"), settings.teams * settings.teSlots, selectedIds);
  selectTop(playersByPosition.get("K"), settings.teams * settings.kSlots, selectedIds);
  selectTop(playersByPosition.get("DST"), settings.teams * settings.dstSlots, selectedIds);

  selectBestRemaining(players, selectedIds, settings.teams * settings.flexSlots, ["RB", "WR", "TE"], metricKey);
  selectBestRemaining(players, selectedIds, settings.teams * settings.superflexSlots, ["QB", "RB", "WR", "TE"], metricKey);
  selectBestRemaining(players, selectedIds, settings.teams * settings.benchSlots, POSITION_ORDER, metricKey);

  return {
    draftedIds: selectedIds,
    totalRosterSpots:
      settings.teams *
      (settings.qbSlots +
        settings.rbSlots +
        settings.wrSlots +
        settings.teSlots +
        settings.flexSlots +
        settings.superflexSlots +
        settings.kSlots +
        settings.dstSlots +
        settings.benchSlots),
  };
}

function selectTop(players, count, selectedIds) {
  if (!players || count <= 0) {
    return;
  }

  let selectedCount = 0;
  for (const player of players) {
    if (selectedCount >= count) {
      break;
    }
    if (!selectedIds.has(player.id)) {
      selectedIds.add(player.id);
      selectedCount += 1;
    }
  }
}

function selectBestRemaining(players, selectedIds, count, allowedPositions, metricKey) {
  if (count <= 0) {
    return;
  }

  const allowed = new Set(allowedPositions);
  const candidates = players
    .filter((player) => allowed.has(player.position) && !selectedIds.has(player.id))
    .sort((left, right) => right[metricKey] - left[metricKey]);

  for (let index = 0; index < Math.min(count, candidates.length); index += 1) {
    selectedIds.add(candidates[index].id);
  }
}

function renderResults() {
  const filtered = state.valuedPlayers.filter((player) => {
    const nameQuery = elements.nameFilter.value.trim().toLowerCase();
    const teamQuery = elements.teamFilter.value.trim().toLowerCase();
    const positionQuery = elements.positionFilter.value;

    const matchesName = !nameQuery || player.name.toLowerCase().includes(nameQuery);
    const matchesTeam = !teamQuery || player.team.toLowerCase().includes(teamQuery);
    const matchesPosition = !positionQuery || player.position === positionQuery;

    return matchesName && matchesTeam && matchesPosition;
  });

  if (!filtered.length) {
    renderEmpty("No players match the current filters.");
    return;
  }

  elements.resultsBody.innerHTML = filtered
    .map(
      (player) => `
        <tr>
          <td>${escapeHtml(player.name)}</td>
          <td>${escapeHtml(player.team)}</td>
          <td>${escapeHtml(player.position)}</td>
          <td>${player.expectedPoints.toFixed(1)}</td>
          <td>${player.ceilingPoints.toFixed(1)}</td>
          <td>$${player.expectedPrice.toFixed(0)}</td>
          <td>$${player.ceilingPrice.toFixed(0)}</td>
          <td>${player.targetPrice == null ? "-" : formatMoney(player.targetPrice)}</td>
          <td>${player.rangeLabel}</td>
          <td>
            <input
              class="sale-input"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              placeholder="$"
              data-sale-input="${escapeAttribute(player.id)}"
            />
          </td>
          <td>
            <button class="table-button" type="button" data-draft-id="${escapeAttribute(player.id)}">
              Mark drafted
            </button>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderEmpty(message) {
  elements.resultsBody.innerHTML = `
    <tr>
      <td colspan="11" class="empty-state">${escapeHtml(message)}</td>
    </tr>
  `;
}

function renderDraftedPlayers() {
  const drafted = [...state.draftedPlayers.values()].sort((left, right) => {
    if ((right.soldPrice ?? -1) !== (left.soldPrice ?? -1)) {
      return (right.soldPrice ?? -1) - (left.soldPrice ?? -1);
    }
    return left.name.localeCompare(right.name);
  });

  if (!drafted.length) {
    elements.draftedBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">No players have been marked as drafted.</td>
      </tr>
    `;
    return;
  }

  elements.draftedBody.innerHTML = drafted
    .map(
      (player) => `
        <tr>
          <td>${escapeHtml(player.name)}</td>
          <td>${escapeHtml(player.team)}</td>
          <td>${escapeHtml(player.position)}</td>
          <td>${player.soldPrice == null ? "-" : formatMoney(player.soldPrice)}</td>
          <td>$${player.expectedPrice.toFixed(0)}</td>
          <td>$${player.ceilingPrice.toFixed(0)}</td>
          <td>${player.targetPrice == null ? "-" : formatMoney(player.targetPrice)}</td>
          <td>
            <button class="table-button" type="button" data-undo-id="${escapeAttribute(player.id)}">
              Restore
            </button>
          </td>
        </tr>
      `
    )
    .join("");
}

function updateSummary(playerCount, remainingCount, settings, auctionableBudget) {
  const totalRosterSpots =
    settings.teams *
    (settings.qbSlots +
      settings.rbSlots +
      settings.wrSlots +
      settings.teSlots +
      settings.flexSlots +
      settings.superflexSlots +
      settings.kSlots +
      settings.dstSlots +
      settings.benchSlots);
  const trackedSpend = [...state.draftedPlayers.values()].reduce(
    (sum, player) => sum + (player.soldPrice ?? 0),
    0
  );

  elements.playersLoaded.textContent = String(playerCount);
  elements.playersRemaining.textContent = String(remainingCount);
  elements.playersDrafted.textContent = String(state.draftedPlayers.size);
  elements.totalRosterSpots.textContent = String(totalRosterSpots);
  elements.leagueBudget.textContent = formatMoney(settings.teams * settings.budget);
  elements.auctionPool.textContent = formatMoney(auctionableBudget);
  elements.trackedSpend.textContent = formatMoney(trackedSpend);
}

function updatePositionFilter(players) {
  const positions = [...new Set(players.map((player) => player.position))].sort(
    (left, right) => POSITION_ORDER.indexOf(left) - POSITION_ORDER.indexOf(right)
  );
  const options = [{ value: "", label: "All" }, ...positions.map((position) => ({ value: position, label: position }))];
  const previous = elements.positionFilter.value;
  populateSelect(elements.positionFilter, options);
  setSelectValue(elements.positionFilter, previous);
}

function getColumnMapping() {
  return {
    name: elements.nameColumn.value,
    team: elements.teamColumn.value,
    position: elements.positionColumn.value,
    expectedPoints: elements.expectedColumn.value,
    ceilingPoints: elements.ceilingColumn.value,
    targetPrice: elements.targetColumn.value,
  };
}

function getSettings() {
  return {
    teams: parseIntSafe(document.getElementById("teams").value, 12),
    budget: parseIntSafe(document.getElementById("budget").value, 200),
    qbSlots: parseIntSafe(document.getElementById("qbSlots").value, 1),
    rbSlots: parseIntSafe(document.getElementById("rbSlots").value, 2),
    wrSlots: parseIntSafe(document.getElementById("wrSlots").value, 2),
    teSlots: parseIntSafe(document.getElementById("teSlots").value, 1),
    flexSlots: parseIntSafe(document.getElementById("flexSlots").value, 1),
    superflexSlots: parseIntSafe(document.getElementById("superflexSlots").value, 0),
    kSlots: parseIntSafe(document.getElementById("kSlots").value, 0),
    dstSlots: parseIntSafe(document.getElementById("dstSlots").value, 0),
    benchSlots: parseIntSafe(document.getElementById("benchSlots").value, 6),
  };
}

function rerunIfReady() {
  if (state.rawRows.length) {
    runValuation();
  }
}

function handleResultsClick(event) {
  const button = event.target.closest("[data-draft-id]");

  if (!button) {
    return;
  }

  const playerId = button.dataset.draftId;
  const player = state.valuedPlayers.find((entry) => entry.id === playerId);

  if (!player) {
    return;
  }

  const saleInput = elements.resultsBody.querySelector(`[data-sale-input="${cssEscape(playerId)}"]`);
  const rawSale = saleInput ? saleInput.value.trim() : "";
  const soldPrice = rawSale === "" ? null : parseNumeric(rawSale);

  state.draftedPlayers.set(playerId, {
    ...player,
    soldPrice: Number.isFinite(soldPrice) ? soldPrice : null,
  });
  runValuation();
}

function handleDraftedClick(event) {
  const button = event.target.closest("[data-undo-id]");

  if (!button) {
    return;
  }

  state.draftedPlayers.delete(button.dataset.undoId);
  runValuation();
}

function populateSelect(selectElement, options) {
  selectElement.innerHTML = options
    .map((option) => `<option value="${escapeAttribute(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");
}

function setSelectValue(selectElement, value) {
  if (!value) {
    return;
  }
  const matchingOption = [...selectElement.options].find((option) => option.value === value);
  if (matchingOption) {
    selectElement.value = value;
  }
}

function findHeader(headers, candidates) {
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: header.trim().toLowerCase(),
  }));

  for (const candidate of candidates) {
    const exact = normalizedHeaders.find((header) => header.normalized === candidate);
    if (exact) {
      return exact.original;
    }
  }

  for (const candidate of candidates) {
    const partial = normalizedHeaders.find((header) => header.normalized.includes(candidate));
    if (partial) {
      return partial.original;
    }
  }

  return headers[0] || "";
}

function parseCsv(text) {
  const rows = [];
  let currentValue = "";
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      if (currentRow.some((cell) => cell.trim() !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length || currentRow.length) {
    currentRow.push(currentValue);
    if (currentRow.some((cell) => cell.trim() !== "")) {
      rows.push(currentRow);
    }
  }

  if (!rows.length) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((cell) => cell.trim());
  const dataRows = rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] || "";
    });
    return record;
  });

  return { headers, rows: dataRows };
}

function parseNumeric(value) {
  const normalized = String(value ?? "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();
  return Number.parseFloat(normalized);
}

function parseOptionalNumeric(value) {
  const normalized = String(value ?? "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.max(1, Math.round(value));
}

function formatMoney(value) {
  return `$${Math.round(value).toLocaleString()}`;
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }

  return String(value).replace(/"/g, '\\"');
}

function setStatus(message, success = false) {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.classList.toggle("success", success);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
