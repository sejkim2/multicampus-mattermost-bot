const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPayload, format10F, main, sendToMattermost } = require("../bot");
const { normalizeWeek, read10F } = require("../lib/menu-10f");
const week = normalizeWeek(require("../examples/10f-2026-10-05.json"));
const today10f = week[1];
const data20f = { date: "2026-10-06", meals: [
  { courseName: "A:한식", photoUrl: "https://example.test/menu.png", nutrition: [
    { name: "20층 테스트 메뉴", isMain: true, calorie: 500, protein: 20, fat: 10, carbohydrate: 70 },
  ] },
] };

test("10층 세 코스를 표시하며 기존 품절 안내와 영양 수치는 표시하지 않는다", () => {
  const text = format10F({ ...today10f, notice: "공존 메뉴는 조기 품절될 수 있습니다." });
  for (const meal of today10f.meals) for (const item of meal.items) assert.ok(text.includes(item));
  assert.match(text, /샌드위치/);
  assert.match(text, /샐러드/);
  assert.doesNotMatch(text, /공존 메뉴는|조기 품절/);
  assert.doesNotMatch(text, /kcal|영양 정보|!\[/);
});

test("10층 미운영일은 사유를 표시한다", () => {
  assert.match(format10F(week[3]), /미운영.*MEET UP/);
  assert.doesNotMatch(format10F(week[3]), /도시락|샌드위치|샐러드/);
});

test("층별 색상 카드에서 20층 사진과 가운데 정렬 표, 10층 메뉴를 유지한다", () => {
  const payload = buildPayload("2026-10-06", data20f, today10f, { test: true });
  assert.match(payload.text, /\[테스트\]/);
  assert.equal(payload.attachments.length, 2);
  const [floor20, floor10] = payload.attachments;
  assert.equal(floor20.color, "#3B82F6");
  assert.equal(floor10.color, "#22C55E");
  assert.match(floor20.title, /20층 삼성웰스토리/);
  assert.match(floor20.text, /menu\.png/);
  assert.match(floor20.text, /\| :---: \| :---: \|/);
  assert.match(floor20.text, /칼로리 500kcal/);
  assert.match(floor10.title, /10층 공존식단/);
  assert.match(floor10.text, /마늘닭볶음탕/);
  assert.ok(floor20.fallback && floor10.fallback);
  assert.doesNotMatch(floor20.text, /칼로리 0kcal/);
});

test("20층 공개 JSON이 없더라도 10층 식단을 전송한다", async () => {
  const calls = [];
  const payload = await main({ date: "2026-10-06", webhookUrl: "https://example.test/hook", test: true,
    fetchImpl: async (url, options) => {
      if (url.includes("raw.githubusercontent.com")) return new Response(null, { status: 404 });
      calls.push({ url, options });
      return new Response("ok");
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  assert.match(payload.attachments[0].text, /메뉴 정보가 아직 없습니다/);
  assert.match(payload.attachments[1].text, /마늘닭볶음탕/);
});

test("테스트와 정식 메시지는 같은 식단과 카드 형식을 사용한다", () => {
  const date = "2026-10-07";
  const data10f = read10F(date);
  const production = buildPayload(date, { ...data20f, date }, data10f);
  const preview = buildPayload(date, { ...data20f, date }, data10f, { test: true });
  assert.deepEqual(production.attachments, preview.attachments);
  assert.equal(production.username, preview.username);
  assert.equal(
    preview.text.replace("[테스트] ", "").replace("\n\n_식단 표시 확인을 위한 테스트 메시지입니다._", ""),
    production.text
  );
  assert.match(production.attachments[1].text, /\*\*옛날돈까스\*\*/);
  assert.doesNotMatch(production.text, /테스트/);
});

test("20층 조회의 영구 오류가 10층 발송을 막지 않는다", async () => {
  let sends = 0;
  await main({ date: "2026-10-06", webhookUrl: "https://example.test/hook",
    fetchImpl: async (url) => {
      if (url.includes("raw.githubusercontent.com")) return new Response(null, { status: 403 });
      sends++;
      return new Response("ok");
    },
  });
  assert.equal(sends, 1);
});

test("20층이 다른 날짜의 식단을 반환하면 표시하지 않는다", async () => {
  const payload = await main({ date: "2026-10-06", webhookUrl: "https://example.test/hook",
    fetchImpl: async (url) => url.includes("raw.githubusercontent.com")
      ? Response.json({ ...data20f, date: "2026-10-05" }) : new Response("ok"),
  });
  assert.doesNotMatch(payload.attachments[0].text, /20층 테스트 메뉴/);
  assert.match(payload.attachments[1].text, /마늘닭볶음탕/);
});

test("20층 메뉴가 있으면 10층 행사 미운영 사유를 함께 전송한다", async () => {
  let payload;
  await main({ date: "2026-10-08", webhookUrl: "https://example.test/hook",
    fetchImpl: async (url, options) => {
      if (url.includes("raw.githubusercontent.com")) return Response.json({ ...data20f, date: "2026-10-08" });
      payload = JSON.parse(options.body);
      return new Response("ok");
    },
  });
  assert.match(payload.attachments[0].text, /20층 테스트 메뉴/);
  assert.match(payload.attachments[1].text, /MEET UP/);
  assert.match(payload.attachments[1].fallback, /미운영.*MEET UP/);
});

test("두 층에 메뉴가 없거나 미운영이면 발송하지 않는다", async () => {
  let calls = 0;
  const payload = await main({ date: "2026-10-09", only10f: true, webhookUrl: "https://example.test/hook",
    fetchImpl: async () => { calls++; throw new Error("웹훅을 호출하면 안 됩니다."); },
  });
  assert.equal(payload, null);
  assert.equal(calls, 0);
});

test("10층 미리보기에는 웹훅과 외부 요청이 필요 없다", async () => {
  const payload = await main({ date: "2026-10-06", only10f: true, dryRun: true, webhookUrl: "",
    fetchImpl: async () => { throw new Error("외부 요청을 호출하면 안 됩니다."); },
  });
  assert.match(payload.attachments[1].text, /참치카나페샐러드/);
});

test("웹훅 오류를 로그에 URL이나 서버 응답 본문 없이 전달한다", async () => {
  await assert.rejects(sendToMattermost({ text: "test" }, "https://example.test/private-hook",
    async () => new Response("private server detail", { status: 403 })), (error) => {
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test("실제 저장된 10층 데이터에 공휴일과 행사 사유가 남아 있다", () => {
  assert.match(read10F("2026-10-05").closureReason, /개천절/);
  assert.match(read10F("2026-10-08").closureReason, /MEET UP/);
  assert.match(read10F("2026-10-09").closureReason, /한글날/);
});
