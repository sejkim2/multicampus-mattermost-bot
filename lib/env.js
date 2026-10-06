const path = require("node:path");

function loadLocalEnv(filename = path.join(__dirname, "..", ".env")) {
  try {
    process.loadEnvFile(filename);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getGeminiApiKey(env = process.env) {
  return env.GEMINI_API_KEY?.trim() || env.gemini_key?.trim() || "";
}

module.exports = { getGeminiApiKey, loadLocalEnv };
