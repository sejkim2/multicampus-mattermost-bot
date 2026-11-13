// 하루 한 번 발송을 보장하기 위한 날짜별 발송 기록(GitHub 태그 `lunch-sent/YYYY-MM-DD`).
//
// GitHub는 이미 있는 이름으로 ref를 만들면 422로 거절하므로, 태그 생성은 원자적인 "선점"으로 쓸 수 있습니다.
// 여러 실행이 동시에 선점을 시도해도 하나만 성공하고, 나머지는 발송하지 않습니다.

const TAG_PREFIX = "lunch-sent/";

function tagRef(date) {
  return `tags/${TAG_PREFIX}${date}`;
}

function createGitHubSendLock({ repository, token, sha, fetchImpl = fetch, apiUrl = "https://api.github.com" }) {
  if (!repository || !token || !sha) throw new Error("GitHub send lock needs repository, token and sha.");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "multicampus-mattermost-bot",
  };

  return {
    describe: (date) => `${repository} refs/${tagRef(date)}`,

    // true: 이번 실행이 오늘 발송권을 얻음 / false: 이미 다른 실행이 얻음 / throw: 판단 불가(발송하지 않음)
    async claim(date) {
      const response = await fetchImpl(`${apiUrl}/repos/${repository}/git/refs`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: `refs/${tagRef(date)}`, sha }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 201) return true;
      if (response.status === 422) return false;
      throw new Error(`Send lock claim failed: HTTP ${response.status}`);
    },

    // 발송이 확실히 실패했을 때만 호출해 다음 실행이 다시 보낼 수 있게 합니다.
    async release(date) {
      const response = await fetchImpl(`${apiUrl}/repos/${repository}/git/refs/${tagRef(date)}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 204 && response.status !== 404 && response.status !== 422) {
        throw new Error(`Send lock release failed: HTTP ${response.status}`);
      }
    },
  };
}

// 실행 환경에 맞는 발송 기록을 고릅니다.
// - 미리보기·테스트 메시지·강제 발송: 기록하지 않음
// - 로컬 실행: 기록하지 않음
// - GitHub Actions: 반드시 기록. 토큰이 없으면(쓰기 권한이 없던 예전 워크플로의 재실행 등) 발송을 거부합니다.
function createSendLockFromEnv(env = process.env, { dryRun = false, test = false, force = false, fetchImpl } = {}) {
  if (dryRun || test || force) return { lock: null };
  if (env.GITHUB_ACTIONS !== "true") return { lock: null };
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !env.GITHUB_SHA) {
    return {
      lock: null,
      refusal: "발송 기록을 남길 수 없는 실행이라 발송하지 않습니다. 예전 실행의 Re-run이라면 "
        + "Actions → Send Multicampus Lunch Menu → Run workflow로 새로 실행하세요.",
    };
  }
  return {
    lock: createGitHubSendLock({
      repository: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
      sha: env.GITHUB_SHA,
      fetchImpl,
    }),
  };
}

module.exports = { TAG_PREFIX, createGitHubSendLock, createSendLockFromEnv };
