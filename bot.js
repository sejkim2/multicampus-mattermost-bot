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

function formatMenu(data) {
  if (!data?.meals?.length) {
    return null;
  }

  const weekday = getKoreanWeekday(data.date);
  const lines = [
    `## 멀티캠퍼스 오늘의 점심`,
    `**${data.date} (${weekday}) · ${data.restaurant ?? "멀티캠퍼스"} · ${data.mealTime ?? "점심"}**`,
    "",
  ];

  for (const meal of data.meals) {
    lines.push(`### ${meal.courseName ?? "메뉴"}`);

    if (meal.setName) {
      lines.push(`**${meal.setName}**`);
    } else if (meal.name) {
      lines.push(`**${meal.name}**`);
    }

    if (Array.isArray(meal.nutrition) && meal.nutrition.length > 0) {
      for (const item of meal.nutrition) {
        const marker = item.isMain ? "★" : "-";
        lines.push(`${marker} ${item.name}`);
      }
    }

    if (meal.photoUrl) {
      lines.push("");
      lines.push(`![${meal.setName ?? meal.name ?? "메뉴 이미지"}](${meal.photoUrl})`);
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

async function sendToMattermost(text) {
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "멀티캠퍼스 점심봇",
      text,
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

  if (!data) {
    return;
  }

  const message = formatMenu(data);

  if (!message) {
    console.log("Menu data is empty. Skipping Mattermost post.");
    return;
  }

  await sendToMattermost(message);
  console.log("Lunch menu sent to Mattermost.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
