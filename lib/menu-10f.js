const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "data-10f");
const COURSES = ["도시락", "브런치", "샐러드"];

function validateDate(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid menu date: ${date}`);
  }
  return date;
}

function normalizeWeek(parsed, { source = {}, updatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(parsed?.days) || parsed.days.length !== 5) {
    throw new Error("주간 식단에는 미운영일을 포함한 월~금 5일이 필요합니다.");
  }
  if (typeof parsed.notice !== "string") throw new Error("식단 안내 문구 형식이 잘못되었습니다.");

  const outputs = parsed.days.map((day) => {
    validateDate(day.date);
    if (!["open", "closed"].includes(day.status)) throw new Error(`${day.date}: 운영 여부가 필요합니다.`);
    if (typeof day.closureReason !== "string" || !day.meals || typeof day.meals !== "object" || Array.isArray(day.meals)) {
      throw new Error(`${day.date}: 식단 형식이 잘못되었습니다.`);
    }
    if (Object.keys(day.meals).some((course) => !COURSES.includes(course))) {
      throw new Error(`${day.date}: 알 수 없는 식단 종류가 있습니다.`);
    }
    const meals = COURSES.flatMap((courseName) => {
      const items = day.meals[courseName] ?? [];
      if (!Array.isArray(items) || items.some((item) => typeof item !== "string" || !item.trim())) {
        throw new Error(`${day.date}: ${courseName} 메뉴는 비어 있지 않은 문자열 배열이어야 합니다.`);
      }
      const cleaned = items.map((item) => item.replace(/^[&＆]\s*/, "").trim());
      if (cleaned.some((item) => !item)) throw new Error(`${day.date}: 빈 메뉴 이름이 있습니다.`);
      return cleaned.length ? [{ courseName, setName: "10층 공존식단", name: cleaned.join(", "), items: cleaned }] : [];
    });
    const closureReason = day.closureReason.trim();
    if (day.status === "open" && (!meals.length || closureReason)) {
      throw new Error(`${day.date}: 운영일에는 메뉴가 있고 미운영 사유가 없어야 합니다.`);
    }
    if (day.status === "closed" && (meals.length || !closureReason)) {
      throw new Error(`${day.date}: 미운영일에는 사유가 있고 메뉴가 없어야 합니다.`);
    }
    const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
    const dayOfWeek = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][weekday];
    return { date: day.date, dayOfWeek, restaurant: "멀티캠퍼스 10층", mealTime: "점심",
      status: day.status, closureReason, notice: parsed.notice.trim(), meals, source, updatedAt };
  }).sort((a, b) => a.date.localeCompare(b.date));

  const monday = new Date(`${outputs[0].date}T12:00:00Z`);
  if (monday.getUTCDay() !== 1 || outputs.some((day, index) => {
    const expected = new Date(monday.valueOf() + index * 24 * 60 * 60 * 1000);
    return day.date !== expected.toISOString().slice(0, 10);
  })) {
    throw new Error("날짜가 같은 주의 월~금과 일치하지 않습니다. 이미지의 연도와 날짜를 확인하세요.");
  }
  return outputs;
}

function saveWeek(outputs, dataDir = DATA_DIR) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const day of outputs) {
    const filename = path.join(dataDir, `${validateDate(day.date)}.json`);
    fs.writeFileSync(`${filename}.tmp`, `${JSON.stringify(day, null, 2)}\n`, "utf8");
    fs.renameSync(`${filename}.tmp`, filename);
  }
  return outputs.map((day) => day.date);
}

function read10F(date, dataDir = DATA_DIR) {
  validateDate(date);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dataDir, `${date}.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (data.date !== date || !Array.isArray(data.meals)) throw new Error(`${date}: 잘못된 10층 식단 파일입니다.`);
  if (data.status !== undefined && !["open", "closed"].includes(data.status)) {
    throw new Error(`${date}: 잘못된 운영 여부입니다.`);
  }
  if (data.status === "closed" && (typeof data.closureReason !== "string" || !data.closureReason.trim() || data.meals.length)) {
    throw new Error(`${date}: 잘못된 미운영 정보입니다.`);
  }
  if (data.status === "open" && !data.meals.length) throw new Error(`${date}: 운영일의 메뉴가 없습니다.`);
  if (data.meals.some((meal) => !COURSES.includes(meal.courseName) || !Array.isArray(meal.items) ||
      !meal.items.length || meal.items.some((item) => typeof item !== "string" || !item.trim()))) {
    throw new Error(`${date}: 잘못된 10층 메뉴입니다.`);
  }
  return data;
}

module.exports = { COURSES, DATA_DIR, normalizeWeek, read10F, saveWeek, validateDate };
