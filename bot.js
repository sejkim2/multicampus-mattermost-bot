const WEBHOOK_URL = process.env.MM_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error("MM_WEBHOOK_URL secret is not configured.");
  process.exit(1);
}

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

async function fetchMenu(dateString) {
  const url =
    `https://raw.githubusercontent.com/C4T4767/baptimessafy/main/data/${dateString}.json`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "multicampus-mattermost-bot",
      Accept: "application/json",
    },
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

  return response.json();
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

async function sendToMattermost(data) {
  const weekday = getKoreanWeekday(data.date);

  const message = [
    `## 멀티캠퍼스 오늘의 점심`,
    `**${data.date} (${weekday}) · ${data.restaurant ?? "멀티캠퍼스"} · ${data.mealTime ?? "점심"}**`,
    "",
    buildMenuTable(data),
  ].join("\n");

  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "멀티캠퍼스 점심봇",
      text: message,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `Mattermost webhook failed: ${response.status} ${response.statusText} ${body}`
    );

    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
}

async function main() {
  const date = getSeoulDate();
  console.log(`Fetching menu for ${date}`);

  const data = await retry(
    () => fetchMenu(date),
    "Menu fetch"
  );

  if (!data?.meals?.length) {
    console.log("Menu data is empty or missing. Skipping Mattermost post.");
    return;
  }

  await retry(
    () => sendToMattermost(data),
    "Mattermost send"
  );

  console.log("Lunch menu sent to Mattermost.");
}

main().catch((error) => {
  console.error("Lunch bot failed after retries.");
  console.error(error);
  process.exit(1);
});
