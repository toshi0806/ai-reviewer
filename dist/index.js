"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const EXCLUDE_PATHS = ((_a = process.env.EXCLUDE_PATHS) === null || _a === void 0 ? void 0 : _a.split(',').map(p => p.trim())) || [];
const LANGUAGE = process.env.LANGUAGE || "English";
const PR_NUMBER = Number(process.env.GITHUB_PR_NUMBER) || 1;
const MODEL_CODE = process.env.MODEL_CODE || "models/gemini-2.0-flash-exp";
if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is missing");
}
if (!OWNER) {
    throw new Error("OWNER is missing");
}
if (!REPO) {
    throw new Error("REPO is missing");
}
(0, utils_1.runReviewBotVercelAI)({
    githubToken: GITHUB_TOKEN,
    owner: OWNER,
    repo: REPO,
    excludePaths: EXCLUDE_PATHS,
    language: LANGUAGE,
    pullNumber: PR_NUMBER,
    modelCode: MODEL_CODE,
    generateReviewCommentFn: utils_1.generateReviewCommentObject,
    postReviewCommentFn: utils_1.realPostReviewComment
});
