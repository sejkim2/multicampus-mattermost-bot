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
    throw new Error(
      `Failed to fetch menu: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

function buildMealText(meal) {
  const lines = [];

  if (Array.isArray(meal.nutrition)) {
    for (const item of meal.nutrition) {
      const marker = item.isMain ? "★" : "•";
      lines.push(`${marker} ${item.name}`);
    }
  }

  return lines.join("\n");
}

function buildAttachments(data) {
  return data.meals.map((meal) => ({
    title: meal.courseName ?? "메뉴",
    text:
      `**${meal.setName ?? meal.name ?? ""}**\n\n` +
      buildMealText(meal),
    thumb_url: meal.photoUrl || undefined,
    fallback: `${meal.courseName ?? "메뉴"} - ${meal.setName ?? meal.name ?? ""}`,
  }));
}

async function sendToMattermost(data) {
  const weekday = getKoreanWeekday(data.date);

  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "멀티캠퍼스 점심봇",
      text: `## 멀티캠퍼스 오늘의 점심\n**${data.date} (${weekday}) · ${data.restaurant ?? "멀티캠퍼스"} · ${data.mealTime ?? "점심"}**`,
      attachments: buildAttachments(data),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Mattermost webhook failed: ${response.status} ${response.statusText} ${body}`
    );
  }
}

async function main() {
  const date = getSeoulDate();
  console.log(`Fetching menu for ${date}`);

  const data = await fetchMenu(date);

  if (!data?.meals?.length) {
    console.log("Menu data is empty or missing. Skipping Mattermost post.");
    return;
  }

  await sendToMattermost(data);
  console.log("Lunch menu sent to Mattermost.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
