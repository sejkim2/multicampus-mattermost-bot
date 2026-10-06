const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { normalizeWeek, read10F, validateDate } = require("../lib/menu-10f");
const { callGemini, collect, findLatest10FImage, imageMimeType, resolveChannelId } = require("../scripts/fetch-10f");
const examplePath = path.join(__dirname, "..", "examples", "10f-2026-10-05.json");
const parsed = require(examplePath);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "multicampus-menu-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("multicampus-menu-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("불가능한 날짜나 경로 형태를 거부한다", () => {
  for (const date of ["2026-02-30", "2026-13-01", "../../other", "2026-1-1"]) {
    assert.throws(() => validateDate(date), /Invalid menu date/);
  }
});

test("이미지 날짜의 요일과 맞지 않는 연도를 거부한다", () => {
  const input = structuredClone(parsed);
  input.days.forEach((day) => { day.date = day.date.replace("2026", "2025"); });
  assert.throws(() => normalizeWeek(input), /월~금/);
});

test("미운영일을 빠뜨리거나 날짜를 중복한 주간 식단을 거부한다", () => {
  const missing = structuredClone(parsed);
  missing.days.pop();
  assert.throws(() => normalizeWeek(missing), /5일/);
  const duplicate = structuredClone(parsed);
  duplicate.days[2].date = duplicate.days[1].date;
  assert.throws(() => normalizeWeek(duplicate), /월~금/);
});

test("미운영에 가짜 메뉴를 넣거나 메뉴 없는 날을 운영일로 표시하면 거부한다", () => {
  const fake = structuredClone(parsed);
  fake.days[0].meals.도시락 = ["가짜 메뉴"];
  assert.throws(() => normalizeWeek(fake), /미운영일/);
  const empty = structuredClone(parsed);
  empty.days[0].status = "open";
  empty.days[0].closureReason = "";
  assert.throws(() => normalizeWeek(empty), /운영일/);
});

test("수동 JSON을 키 없이 저장하고 반복 가져오기는 파일을 변경하지 않는다", async (t) => {
  const dataDir = tempDirectory(t);
  const options = { jsonPath: examplePath, referenceDate: "2026-10-06", dataDir, env: {},
    fetchImpl: async () => { throw new Error("수동 JSON에는 외부 요청이 필요 없습니다."); },
  };
  const dates = await collect(options);
  assert.equal(dates.length, 5);
  assert.equal(read10F("2026-10-06", dataDir).meals.length, 3);
  const before = fs.readFileSync(path.join(dataDir, "2026-10-06.json"), "utf8");
  await collect(options);
  assert.equal(fs.readFileSync(path.join(dataDir, "2026-10-06.json"), "utf8"), before);
  fs.unlinkSync(path.join(dataDir, "2026-10-07.json"));
  await collect(options);
  assert.ok(read10F("2026-10-07", dataDir));
});

test("잘못된 주간 JSON은 기존 데이터를 덮어쓰기 전에 거부한다", async (t) => {
  const dataDir = tempDirectory(t);
  await collect({ jsonPath: examplePath, referenceDate: "2026-10-06", dataDir, env: {} });
  const before = fs.readFileSync(path.join(dataDir, "2026-10-06.json"), "utf8");
  const invalid = structuredClone(parsed);
  invalid.days[4].date = "2026-10-40";
  const jsonPath = path.join(dataDir, "invalid.json");
  fs.writeFileSync(jsonPath, JSON.stringify(invalid));
  await assert.rejects(collect({ jsonPath, referenceDate: "2026-10-06", dataDir, env: {} }), /Invalid menu date/);
  assert.equal(fs.readFileSync(path.join(dataDir, "2026-10-06.json"), "utf8"), before);
});

test("Gemini 요청은 실제 이미지 MIME과 JSON 스키마를 사용하고 응답을 검증한다", async () => {
  const jpeg = Buffer.from([255, 216, 255, 224]);
  const result = await callGemini(jpeg, { referenceDate: "2026-10-06", model: "test-model", apiKey: "test-key",
    fetchImpl: async (url, options) => {
      assert.doesNotMatch(url, /test-key/);
      assert.equal(options.headers["x-goog-api-key"], "test-key");
      const request = JSON.parse(options.body);
      assert.equal(request.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
      assert.equal(request.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }] });
    },
  });
  assert.deepEqual(result, parsed);
});

test("Gemini JSON 응답이라도 날짜 검증에 실패하면 저장하지 않는다", async () => {
  await assert.rejects(callGemini(png, { referenceDate: "2026-10-06", model: "test-model", apiKey: "test-key",
    fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"notice":"","days":[]}' }] } }] }),
  }), /Gemini 식단 검증 실패/);
});

test("로컬 env 파일의 gemini_key를 불러오며 기존 환경 변수는 유지한다", (t) => {
  const dataDir = tempDirectory(t);
  const envFile = path.join(dataDir, ".env");
  fs.writeFileSync(envFile, 'gemini_key="local-test-key"\nGEMINI_API_KEY=file-test-key\n');
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    require('./lib/env').loadLocalEnv(process.argv[1]);
    assert.equal(process.env.gemini_key, 'local-test-key');
    assert.equal(process.env.GEMINI_API_KEY, 'existing-test-key');
  `, envFile], {
    cwd: path.join(__dirname, ".."), encoding: "utf8",
    env: { ...process.env, gemini_key: undefined, GEMINI_API_KEY: "existing-test-key" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("gemini_key로 이미지 파싱 요청을 인증하고 결과를 저장한다", async (t) => {
  const dataDir = tempDirectory(t);
  const imagePath = path.join(dataDir, "menu.png");
  fs.writeFileSync(imagePath, png);
  const dates = await collect({ imagePath, dataDir, referenceDate: "2026-10-06", env: { gemini_key: "local-test-key" },
    fetchImpl: async (url, options) => {
      assert.equal(options.headers["x-goog-api-key"], "local-test-key");
      assert.doesNotMatch(url, /local-test-key/);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }] });
    },
  });
  assert.equal(dates.length, 5);
  assert.equal(read10F("2026-10-06", dataDir).meals.length, 3);
});

test("조회 채널 ID가 팀 이름보다 우선하며 웹훅 주소를 채널로 사용하지 않는다", async () => {
  assert.equal(await resolveChannelId("token", { MM_MENU_CHANNEL_ID: "configured-channel", MM_MENU_TEAM_NAME: "other" }), "configured-channel");
  await assert.rejects(resolveChannelId("token", {}), /Incoming Webhook/);
});

test("주간 이미지 탐색은 지정 채널의 최신 10층 첨부 파일을 고른다", async () => {
  const now = Date.now();
  const image = await findLatest10FImage("test-token", "channel", { env: {}, fetchImpl: async (url) => {
    if (url.includes("/posts?")) return Response.json({ order: ["post"], posts: { post: { create_at: now, file_ids: ["other", "menu"] } } });
    if (url.includes("/files/other/info")) return Response.json({ name: "공지.png", mime_type: "image/png" });
    if (url.includes("/files/menu/info")) return Response.json({ name: "10층_식단.png", mime_type: "image/png" });
    throw new Error("다른 채널을 탐색하면 안 됩니다.");
  } });
  assert.equal(image.fileId, "menu");
});

test("오래된 식단 게시글은 선택하지 않는다", async () => {
  const image = await findLatest10FImage("test-token", "channel", { env: {}, fetchImpl: async () =>
    Response.json({ order: ["old"], posts: { old: { create_at: 0, file_ids: ["menu"] } } }),
  });
  assert.equal(image, null);
});

test("이미지 확장자 대신 실제 파일 형식을 확인한다", () => {
  assert.equal(imageMimeType(png), "image/png");
  assert.throws(() => imageMimeType(Buffer.from("not an image")), /PNG, JPEG, WebP/);
});

function mattermostCollectionFixture(t, { reactions = [], geminiStatus = 200, reactionStatus = 201 } = {}) {
  const dataDir = tempDirectory(t);
  const state = { reactions: [...reactions], geminiStatus, reactionStatus, geminiCalls: 0, reactionPosts: [],
    postId: "menu-post" };
  const options = {
    dataDir, referenceDate: "2026-10-06",
    env: { MM_LOGIN_JSON: '{"login_id":"test-user","password":"test-password"}',
      MM_MENU_CHANNEL_ID: "menu-channel", gemini_key: "test-key" },
    fetchImpl: async (url, requestOptions = {}) => {
      if (url.endsWith("/users/login")) return new Response("{}", { headers: { Token: "test-token" } });
      if (url.includes("/channels/menu-channel/posts?")) {
        return Response.json({ order: [state.postId], posts: {
          [state.postId]: { create_at: Date.now(), file_ids: ["menu-image"] },
        } });
      }
      if (url.endsWith("/files/menu-image/info")) return Response.json({ name: "10층_식단.png", mime_type: "image/png" });
      if (url.endsWith("/files/menu-image")) return new Response(png);
      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        state.geminiCalls++;
        if (state.geminiStatus !== 200) return new Response(null, { status: state.geminiStatus });
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }] });
      }
      if (url.endsWith("/users/me")) return Response.json({ id: "collector-user" });
      if (url.endsWith("/posts/" + state.postId + "/reactions")) {
        return Response.json(state.reactions.filter((reaction) => reaction.post_id === state.postId));
      }
      if (url.endsWith("/api/v4/reactions")) {
        assert.equal(requestOptions.headers.Authorization, "Bearer test-token");
        assert.equal(requestOptions.method, "POST");
        assert.ok(fs.existsSync(path.join(dataDir, ".last-parsed.json")), "반응 전에 파싱 이력을 저장해야 합니다.");
        for (const day of parsed.days) assert.ok(read10F(day.date, dataDir), "반응 전에 모든 날짜를 저장해야 합니다.");
        const reaction = JSON.parse(requestOptions.body);
        state.reactionPosts.push(reaction);
        if (state.reactionStatus !== 201) return new Response(null, { status: state.reactionStatus });
        state.reactions.push(reaction);
        return Response.json(reaction, { status: 201 });
      }
      throw new Error("Unexpected test request");
    },
  };
  return { options, state, dataDir };
}

test("식단과 파싱 이력을 저장한 뒤 수집 계정으로 원본 게시글에 완료 반응을 남긴다", async (t) => {
  const { options, state } = mattermostCollectionFixture(t);
  const dates = await collect(options);
  assert.equal(dates.length, 5);
  assert.deepEqual(state.reactionPosts, [{ user_id: "collector-user", post_id: "menu-post", emoji_name: "white_check_mark" }]);
});

test("반복 수집은 Gemini 호출과 이미 등록된 완료 반응을 중복하지 않는다", async (t) => {
  const { options, state } = mattermostCollectionFixture(t);
  await collect(options);
  await collect(options);
  assert.equal(state.geminiCalls, 1);
  assert.equal(state.reactionPosts.length, 1);
});

test("같은 이미지가 새 게시글에 올라오면 파싱을 재사용하고 새 게시글에도 반응을 남긴다", async (t) => {
  const { options, state } = mattermostCollectionFixture(t);
  await collect(options);
  state.postId = "reposted-menu";
  await collect(options);
  assert.equal(state.geminiCalls, 1);
  assert.equal(state.reactionPosts.length, 2);
  assert.equal(state.reactionPosts[1].post_id, "reposted-menu");
});

test("다른 사용자의 체크 반응이 있어도 수집 계정의 완료 반응을 남긴다", async (t) => {
  const { options, state } = mattermostCollectionFixture(t, {
    reactions: [{ user_id: "another-user", post_id: "menu-post", emoji_name: "white_check_mark" }],
  });
  await collect(options);
  assert.equal(state.reactionPosts.length, 1);
  assert.equal(state.reactionPosts[0].user_id, "collector-user");
});

test("Gemini 파싱에 실패하면 수집 완료 반응을 남기지 않는다", async (t) => {
  const { options, state, dataDir } = mattermostCollectionFixture(t, { geminiStatus: 400 });
  await assert.rejects(collect(options), /Gemini 요청 실패/);
  assert.equal(state.reactionPosts.length, 0);
  assert.equal(fs.existsSync(path.join(dataDir, ".last-parsed.json")), false);
});

test("반응 등록 실패 시 식단을 유지하고 다음 실행에서 파싱 없이 반응만 보완한다", async (t) => {
  const { options, state, dataDir } = mattermostCollectionFixture(t, { reactionStatus: 403 });
  await collect(options);
  assert.ok(read10F("2026-10-06", dataDir));
  state.reactionStatus = 201;
  await collect(options);
  assert.equal(state.geminiCalls, 1);
  assert.equal(state.reactionPosts.length, 2);
  assert.equal(state.reactions.length, 1);
});
