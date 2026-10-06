const { parseArgs } = require("node:util");
const { read10F, validateDate } = require("./lib/menu-10f");
require("./lib/env").loadLocalEnv();

const SEOUL_TZ = "Asia/Seoul";

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getKoreanWeekday(dateString) {
  const date = new Date(`${dateString}T12:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TZ,
    weekday: "long",
  }).format(date);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(fn, label, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (error?.retryable === false) {
        throw error;
      }

      if (attempt === maxAttempts) {
        break;
      }

      const delayMs = attempt * 10000;
      console.warn(
        `${label} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs / 1000}s...`
      );
      console.warn(error?.message ?? error);

      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function fetchMenu(dateString, fetchImpl = fetch) {
  const url =
    `https://raw.githubusercontent.com/C4T4767/baptimessafy/main/data/${dateString}.json`;

  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "multicampus-mattermost-bot",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (response.status === 404) {
    console.log(`No menu JSON found for ${dateString}. Skipping.`);
    return null;
  }

  if (!response.ok) {
    const error = new Error(
      `Failed to fetch menu: ${response.status} ${response.statusText}`
    );

    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }

  const data = await response.json();
  if (data.date !== dateString || !Array.isArray(data.meals)) {
    const error = new Error("20F menu JSON has an invalid date or meals field.");
    error.retryable = false;
    throw error;
  }
  return data;
}

function escapeCell(value = "") {
  return String(value)
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function courseLabel(meal) {
  const raw = meal.courseName ?? "메뉴";
  const parts = raw.split(":");
  return escapeCell(parts.length > 1 ? parts.slice(1).join(":") : raw);
}

function itemLabel(item) {
  const kcal =
    typeof item.calorie === "number" ? ` (${Math.round(item.calorie)}kcal)` : "";
  return `${escapeCell(item.name)}${kcal}`;
}

function nutritionSummary(meal) {
  const items = Array.isArray(meal.nutrition) ? meal.nutrition : [];

  if (!items.some((item) => typeof item.calorie === "number")) {
    return "정보 없음";
  }

  const sum = (key) =>
    Math.round(
      items.reduce(
        (total, item) =>
          total + (typeof item[key] === "number" ? item[key] : 0),
        0
      )
    );

  return [
    `칼로리 ${sum("calorie")}kcal`,
    `단백질 ${sum("protein")}g`,
    `지방 ${sum("fat")}g`,
    `탄수화물 ${sum("carbohydrate")}g`,
  ].join(" / ");
}

function buildMenuTable(data) {
  const meals = data.meals.slice(0, 2);

  if (meals.length === 0) {
    return "";
  }

  if (meals.length === 1) {
    meals.push({
      courseName: "",
      photoUrl: "",
      nutrition: [],
    });
  }

  const [left, right] = meals;

  const rows = [
    `| **${courseLabel(left)}** | **${courseLabel(right)}** |`,
    "| :---: | :---: |",
    `| ${left.photoUrl ? `![${courseLabel(left)}](${left.photoUrl} =220)` : ""} | ${right.photoUrl ? `![${courseLabel(right)}](${right.photoUrl} =220)` : ""} |`,
  ];

  const leftItems = Array.isArray(left.nutrition) ? left.nutrition : [];
  const rightItems = Array.isArray(right.nutrition) ? right.nutrition : [];
  const maxItems = Math.max(leftItems.length, rightItems.length);

  for (let i = 0; i < maxItems; i++) {
    const l = leftItems[i];
    const r = rightItems[i];

    let leftText = l ? itemLabel(l) : "";
    let rightText = r ? itemLabel(r) : "";

    if (l?.isMain) leftText = `**${leftText}**`;
    if (r?.isMain) rightText = `**${rightText}**`;

    rows.push(`| ${leftText} | ${rightText} |`);
  }

  rows.push(
    `| **영양 정보:** ${escapeCell(nutritionSummary(left))} | **영양 정보:** ${escapeCell(nutritionSummary(right))} |`
  );

  return rows.join("\n");
}

function format10F(data) {
  if (!data) return "_오늘 메뉴 정보가 아직 없습니다._";
  if (data.status === "closed") {
    return `**미운영** · ${escapeCell(data.closureReason)}`;
  }
  if (!data.meals.length) return "_오늘 메뉴 정보가 아직 없습니다._";

  const labels = { 도시락: "🍱 도시락", 브런치: "🥪 샌드위치", 샐러드: "🥗 샐러드" };
  const lines = data.meals.map((meal) =>
    `**${labels[meal.courseName] ?? escapeCell(meal.courseName)}**\n${meal.items.map((item, index) => index === 0 ? `**${escapeCell(item)}**` : escapeCell(item)).join(" · ")}`
  );
  if (data.notice) lines.push(`_${escapeCell(data.notice)}_`);
  return lines.join("\n\n");
}

function buildPayload(date, data20f, data10f, { test = false } = {}) {
  const weekday = getKoreanWeekday(date);
  const message = [
    `## ${test ? "[테스트] " : ""}멀티캠퍼스 오늘의 점심`,
    `**${date} (${weekday})**`,
    ...(test ? ["", "_식단 표시 확인을 위한 테스트 메시지입니다._"] : []),
  ].join("\n");

  return {
    username: "멀티캠퍼스 점심봇",
    text: message,
    attachments: [
      {
        fallback: `${date} 20층 삼성웰스토리 식단`,
        color: "#3B82F6",
        title: "🏢 20층 삼성웰스토리",
        text: data20f?.meals?.length ? buildMenuTable(data20f) : "_오늘 메뉴 정보가 아직 없습니다._",
      },
      {
        fallback: data10f?.status === "closed"
          ? `${date} 10층 공존식단 미운영: ${data10f.closureReason}`
          : `${date} 10층 공존식단 식단`,
        color: "#22C55E",
        title: "🏢 10층 공존식단",
        text: format10F(data10f),
      },
    ],
  };
}

async function sendToMattermost(payload, webhookUrl, fetchImpl = fetch) {
  if (!webhookUrl) {
    throw new Error("MM_WEBHOOK_URL secret is not configured.");
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = new Error(`Mattermost webhook failed: HTTP ${response.status}`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
}

async function main({
  date = getSeoulDate(),
  only10f = false,
  dryRun = false,
  test = false,
  webhookUrl = process.env.MM_WEBHOOK_URL,
  dataDir,
  fetchImpl = fetch,
} = {}) {
  validateDate(date);
  if (!dryRun && !webhookUrl) throw new Error("MM_WEBHOOK_URL secret is not configured.");
  console.log(`Fetching menu for ${date}`);

  const results = await Promise.allSettled([
    only10f ? Promise.resolve(null) : retry(() => fetchMenu(date, fetchImpl), "20F menu fetch"),
    Promise.resolve().then(() => read10F(date, dataDir)),
  ]);
  const data = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(`${index === 0 ? "20F" : "10F"} menu unavailable: ${result.reason.message}`);
    return null;
  });
  const [data20f, data10f] = data;
  if (!data20f?.meals?.length && !data10f?.meals?.length) {
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    console.log("Both floors have no menu or are closed. Skipping Mattermost post.");
    return null;
  }

  const payload = buildPayload(date, data20f, data10f, { test });
  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  await retry(() => sendToMattermost(payload, webhookUrl, fetchImpl), "Mattermost send");
  console.log("Lunch menu sent to Mattermost.");
  return payload;
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const { values } = parseArgs({ options: {
      date: { type: "string" },
      "only-10f": { type: "boolean" },
      "dry-run": { type: "boolean" },
      test: { type: "boolean" },
    } });
    return main({ date: values.date, only10f: values["only-10f"], dryRun: values["dry-run"], test: values.test });
  }).catch((error) => {
    console.error(`Lunch bot failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildMenuTable, buildPayload, fetchMenu, format10F, getSeoulDate, main, sendToMattermost };
