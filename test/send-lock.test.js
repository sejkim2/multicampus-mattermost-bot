const assert = require("node:assert/strict");
const test = require("node:test");
const { getSeoulDate, main } = require("../bot");
const { createGitHubSendLock, createSendLockFromEnv } = require("../lib/send-lock");

const DATE = "2026-10-06"; // examples 기반 10층 식단이 있는 날
const HOOK = "https://example.test/hook";
const API = "https://api.github.com";
const ENV = { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_SHA: "abc" };

// 가짜 GitHub(ref 저장소)와 가짜 Mattermost. 실제 요청은 보내지 않습니다.
function createWorld({ webhook = () => new Response("ok"), github } = {}) {
  const refs = new Set();
  const posts = [];
  const githubCalls = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("raw.githubusercontent.com")) return new Response(null, { status: 404 });
    if (url.startsWith(API)) {
      githubCalls.push({ url, method: options.method });
      if (github) {
        const custom = await github(url, options);
        if (custom) return custom;
      }
      if (options.method === "POST") {
        const { ref } = JSON.parse(options.body);
        if (refs.has(ref)) return new Response("{}", { status: 422 });
        refs.add(ref);
        return new Response("{}", { status: 201 });
      }
      if (options.method === "DELETE") {
        const ref = `refs/${url.split("/git/refs/")[1]}`;
        return new Response(null, { status: refs.delete(ref) ? 204 : 404 });
      }
    }
    if (url === HOOK) {
      posts.push(JSON.parse(options.body));
      return webhook(posts.length);
    }
    throw new Error(`unexpected request ${url}`);
  };
  const lock = () => createSendLockFromEnv(ENV, { fetchImpl }).lock;
  const run = (extra = {}) => main({ date: DATE, webhookUrl: HOOK, fetchImpl, lock: lock(), retryBaseDelayMs: 1, ...extra });
  return { refs, posts, githubCalls, fetchImpl, run };
}

test("정상 예약 실행은 발송 기록을 남기고 한 번 보낸다", async () => {
  const world = createWorld();
  await world.run();
  assert.equal(world.posts.length, 1);
  assert.ok(world.refs.has(`refs/tags/lunch-sent/${DATE}`));
});

test("늦게 시작된 예약 실행(10시)도 아직 안 보냈으면 한 번 보낸다", async () => {
  const world = createWorld();
  await world.run();
  assert.equal(world.posts.length, 1);
});

test("두 예약 실행이 연속으로 돌면 두 번째는 보내지 않는다", async () => {
  const world = createWorld();
  await world.run();
  assert.equal(await world.run(), null);
  assert.equal(world.posts.length, 1);
});

test("수동 발송 뒤 시작된 예약 실행은 건너뛴다", async () => {
  const world = createWorld();
  await world.run(); // workflow_dispatch(dry_run·test_message 해제)도 같은 기록을 사용
  await world.run(); // 늦게 온 schedule
  assert.equal(world.posts.length, 1);
});

test("예약 실행이 9시까지 기다리는 동안 수동으로 먼저 보내면, 대기 후 예약 실행은 보내지 않는다", async () => {
  const world = createWorld();
  const waitingScheduled = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 20)); // 09:00까지 대기
    return world.run();
  })();
  await world.run(); // 대기 중 수동 발송
  assert.equal(await waitingScheduled, null);
  assert.equal(world.posts.length, 1);
});

test("수동 실행과 예약 실행이 동시에 시작해도 한 번만 보낸다", async () => {
  const world = createWorld();
  const results = await Promise.all([world.run(), world.run(), world.run()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(world.posts.length, 1);
});

test("과거에 생성된 실행을 오늘 재실행해도, 오늘 이미 보냈으면 건너뛴다", async () => {
  // 재실행이 언제 생성됐든 bot.js는 발송 날짜(한국시간 오늘)의 기록만 봅니다.
  const world = createWorld();
  await world.run();
  await world.run();
  assert.equal(world.posts.length, 1);
});

test("발송 기록을 남길 수 없는 예전 워크플로의 재실행은 발송을 거부한다", () => {
  // 7cf2d04 이전 lunch.yml은 contents: read이고 GITHUB_TOKEN을 넘기지 않습니다.
  const { lock, refusal } = createSendLockFromEnv({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "o/r", GITHUB_SHA: "abc" });
  assert.equal(lock, null);
  assert.match(refusal, /Run workflow/);
});

test("Mattermost가 확실히 실패하면 기록을 지우고, 다음 실행이 다시 보낸다", async () => {
  let failing = true;
  const world = createWorld({ webhook: () => new Response("err", { status: failing ? 500 : 200 }) });
  await assert.rejects(world.run(), /HTTP 500/);
  assert.equal(world.refs.size, 0);
  assert.equal(world.posts.length, 3); // 5xx는 3번까지 재시도
  failing = false;
  await world.run();
  assert.equal(world.posts.length, 4);
  assert.equal(world.refs.size, 1);
});

test("Mattermost 응답 시간 초과는 재전송하지 않고 기록을 유지해 중복을 막는다", async () => {
  const world = createWorld({ webhook: () => { throw new DOMException("timeout", "TimeoutError"); } });
  await assert.rejects(world.run(), /may or may not have been posted/);
  assert.equal(world.posts.length, 1);
  assert.equal(world.refs.size, 1);
  assert.equal(await world.run(), null); // 다음 실행도 보내지 않음
  assert.equal(world.posts.length, 1);
});

test("연결 자체가 안 된 오류는 재시도해서 보낸다", async () => {
  const world = createWorld({ webhook: (n) => { if (n === 1) throw new TypeError("fetch failed"); return new Response("ok"); } });
  await world.run();
  assert.equal(world.posts.length, 2);
  assert.equal(world.refs.size, 1);
});

test("발송 기록 API 조회에 실패하면 보내지 않고 오류로 끝낸다", async () => {
  const world = createWorld({ github: (url, options) => options.method === "POST" ? new Response("{}", { status: 503 }) : null });
  await assert.rejects(world.run(), /Send lock claim failed: HTTP 503/);
  assert.equal(world.posts.length, 0);
});

test("발송 기록 삭제가 실패해도 원래 발송 오류를 그대로 알린다", async () => {
  const world = createWorld({
    webhook: () => new Response("bad", { status: 400 }),
    github: (url, options) => options.method === "DELETE" ? new Response("{}", { status: 500 }) : null,
  });
  await assert.rejects(world.run(), /HTTP 400/);
  assert.equal(world.posts.length, 1); // 4xx는 재시도하지 않음
});

test("식단이 없는 날은 발송 기록을 남기지 않는다", async () => {
  const world = createWorld();
  assert.equal(await world.run({ date: "2026-10-08" }), null); // 20층 없음 + 10층 미운영
  assert.equal(world.githubCalls.length, 0);
  assert.equal(world.posts.length, 0);
});

test("미리보기·테스트 메시지·강제 발송은 발송 기록을 쓰지 않는다", () => {
  for (const options of [{ dryRun: true }, { test: true }, { force: true }]) {
    const { lock, refusal } = createSendLockFromEnv(ENV, options);
    assert.equal(lock, null);
    assert.equal(refusal, undefined);
  }
  assert.equal(createSendLockFromEnv({}, {}).lock, null); // 로컬 실행
});

test("날짜가 바뀌는 시점은 한국시간 기준으로 판단한다", () => {
  assert.equal(getSeoulDate(new Date("2026-11-12T14:59:59Z")), "2026-11-12");
  assert.equal(getSeoulDate(new Date("2026-11-12T15:00:00Z")), "2026-11-13");
});

test("발송 기록은 GitHub 태그 lunch-sent/날짜를 원자적으로 만든다", async () => {
  const calls = [];
  const lock = createGitHubSendLock({ repository: "o/r", token: "t", sha: "abc", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response("{}", { status: calls.length === 1 ? 201 : 422 });
  } });
  assert.equal(await lock.claim(DATE), true);
  assert.equal(await lock.claim(DATE), false);
  assert.equal(calls[0].url, `${API}/repos/o/r/git/refs`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { ref: `refs/tags/lunch-sent/${DATE}`, sha: "abc" });
  assert.equal(calls[0].options.headers.Authorization, "Bearer t");
});
