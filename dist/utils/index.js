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
exports.fetchPullRequest = fetchPullRequest;
exports.fetchPullRequestFiles = fetchPullRequestFiles;
exports.filterFiles = filterFiles;
exports.createDiffText = createDiffText;
exports.createReviewPrompt = createReviewPrompt;
exports.postReviewComment = postReviewComment;
exports.runReviewBotVercelAI = runReviewBotVercelAI;
// reviewBot.js
const ai_1 = require("ai");
const google_1 = require("@ai-sdk/google");
const rest_1 = require("@octokit/rest");
const minimatch_1 = require("minimatch");
/**
 * GitHub の PR 情報を取得
 */
function fetchPullRequest(octokit, owner, repo, pullNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield octokit.pulls.get({
            owner,
            repo,
            pull_number: pullNumber,
        });
        return data;
    });
}
/**
 * GitHub の PR のファイル情報を取得
 */
function fetchPullRequestFiles(octokit, owner, repo, pullNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield octokit.pulls.listFiles({
            owner,
            repo,
            pull_number: pullNumber,
        });
        return data;
    });
}
/**
 * 除外パスリスト (EXCLUDE_PATHS) に該当しないファイルだけをフィルタする
 */
function filterFiles(files, excludePaths) {
    return files.filter(file => {
        return !excludePaths.some(pattern => (0, minimatch_1.minimatch)(file.filename, pattern, { matchBase: true }));
    });
}
/**
 * 差分テキスト(diffText) を生成する
 */
function createDiffText(files) {
    return files
        .map(file => `---\nFile: ${file.filename}\nPatch:\n${file.patch}`)
        .join("\n\n");
}
/**
 * AI に投げるプロンプトを生成する
 */
function createReviewPrompt({ prTitle, prBody, diffText, language }) {
    return `
You're a sophisticated software engineer.
Please check the code changes in the following Pull Request and point out any potential problems or areas for improvement.
Your review MUST be written in ${language}.

Pull Request Title: ${prTitle}
Pull Request Body: ${prBody}

Diffs:
${diffText}
`;
}
/**
 * レビューコメントを GitHub に投稿する
 */
function postReviewComment(octokit_1, _a) {
    return __awaiter(this, arguments, void 0, function* (octokit, { owner, repo, pullNumber, reviewComment }) {
        yield octokit.pulls.createReview({
            owner,
            repo,
            pull_number: pullNumber,
            body: reviewComment,
            event: "COMMENT",
        });
    });
}
/**
 * メイン処理
 */
function runReviewBotVercelAI(_a) {
    return __awaiter(this, arguments, void 0, function* ({ githubToken, owner, repo, pullNumber, excludePaths, language, modelCode, }) {
        try {
            const octokit = new rest_1.Octokit({ auth: githubToken });
            // 1. PRデータの取得
            const prData = yield fetchPullRequest(octokit, owner, repo, pullNumber);
            // 2. ファイル一覧の取得
            const filesData = yield fetchPullRequestFiles(octokit, owner, repo, pullNumber);
            // 3. 除外パスのフィルタリング
            const filteredFiles = filterFiles(filesData, excludePaths);
            // 4. 差分テキストの生成
            const diffText = createDiffText(filteredFiles);
            // 5. プロンプトの生成
            const userPrompt = createReviewPrompt({
                prTitle: prData.title,
                prBody: prData.body,
                diffText,
                language,
            });
            console.log("--- Prompt ---");
            console.log(userPrompt);
            // 6. AI にレビュー文を生成してもらう
            const { text: reviewComment } = yield (0, ai_1.generateText)({
                model: (0, google_1.google)(modelCode),
                prompt: userPrompt,
            });
            console.log("--- Review ---");
            console.log(reviewComment);
            // 7. GitHub にレビュー文を投稿
            yield postReviewComment(octokit, {
                owner,
                repo,
                pullNumber,
                reviewComment,
            });
        }
        catch (error) {
            console.error("Error in runReviewBotVercelAI:", error);
        }
    });
}
