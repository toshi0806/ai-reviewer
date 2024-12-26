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
Object.defineProperty(exports, "__esModule", { value: true });
const ai_1 = require("ai");
const google_1 = require("@ai-sdk/google");
const rest_1 = require("@octokit/rest");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OWNER = process.env.GITHUB_OWNER || 'your-github-owner';
const REPO = process.env.GITHUB_REPO || 'your-github-repo';
const PR_NUMBER = Number(process.env.GITHUB_PR_NUMBER) || 1;
const octokit = new rest_1.Octokit({
    auth: GITHUB_TOKEN,
});
function runReviewBotVercelAI() {
    return __awaiter(this, void 0, void 0, function* () {
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
            const diffText = filesData
                .map((file) => `---\nFile: ${file.filename}\nPatch:\n${file.patch}`)
                .join('\n\n');
            const userPrompt = `
        あなたは優秀なソフトウェアエンジニアです。
        以下のPull Requestのコード変更をチェックし、潜在的な問題や改善すべき点を指摘してください。
        Pull Request Title: ${prData.title}
        Pull Request Body: ${prData.body}

        Diffs:
        ${diffText}
`;
            const { text: reviewComment } = yield (0, ai_1.generateText)({
                model: (0, google_1.google)("models/gemini-1.5-pro-latest"),
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
