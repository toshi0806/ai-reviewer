"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const ai_1 = require("ai");
const google_1 = require("@ai-sdk/google");
const rest_1 = require("@octokit/rest");
const minimatch_1 = require("minimatch");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const EXCLUDE_PATHS = ((_a = process.env.EXCLUDE_PATHS) === null || _a === void 0 ? void 0 : _a.split(',').map(p => p.trim())) || [];
const LANGUAGE = process.env.LANGUAGE || "English";
const PR_NUMBER = Number(process.env.GITHUB_PR_NUMBER) || 1;
const MODEL_CODE = process.env.MODEL_CODE || "models/gemini-2.0-flash-exp";
const octokit = new rest_1.Octokit({
    auth: GITHUB_TOKEN,
});
function runReviewBotVercelAI() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!GITHUB_TOKEN) {
            throw new Error("GITHUB_TOKEN is missing");
        }
        if (!OWNER) {
            throw new Error("OWNER is missing");
        }
        if (!REPO) {
            throw new Error("REPO is missing");
        }
        try {
            const { data: prData } = yield octokit.pulls.get({
                owner: OWNER,
                repo: REPO,
                pull_number: PR_NUMBER,
            });
            const { data: filesData } = yield octokit.pulls.listFiles({
                owner: OWNER,
                repo: REPO,
                pull_number: PR_NUMBER,
            });
            const filteredFiles = filesData.filter(file => {
                return !EXCLUDE_PATHS.some(pattern => (0, minimatch_1.minimatch)(file.filename, pattern, { matchBase: true }));
            });
            const diffText = filteredFiles
                .map((file) => `---\nFile: ${file.filename}\nPatch:\n${file.patch}`)
                .join('\n\n');
            const userPrompt = `
        You're a sophisticated software engineer
        Please check the code changes in the following Pull Request and point out any potential problems or areas for improvement.
        Your review MUST written in ${LANGUAGE}
        Pull Request Title: ${prData.title}
        Pull Request Body: ${prData.body}

        Diffs:
        ${diffText}
`;
            const { text: reviewComment } = yield (0, ai_1.generateText)({
                model: (0, google_1.google)(MODEL_CODE),
                prompt: userPrompt
            });
            console.log('--- 自動生成されたコードレビュー (vercel/ai) ---');
            console.log(reviewComment);
            yield octokit.pulls.createReview({
                owner: OWNER,
                repo: REPO,
                pull_number: PR_NUMBER,
                body: reviewComment,
                event: "COMMENT",
            });
        }
        catch (error) {
            console.error('Error in runReviewBotVercelAI:', error);
        }
    });
}
runReviewBotVercelAI();
