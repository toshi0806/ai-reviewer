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
exports.parseFiles = parseFiles;
exports.createReviewPrompt = createReviewPrompt;
exports.realPostReviewComment = realPostReviewComment;
exports.dryRunPostReviewComment = dryRunPostReviewComment;
exports.createParsedDiffText = createParsedDiffText;
exports.runReviewBotVercelAI = runReviewBotVercelAI;
const ai_1 = require("ai");
const google_1 = require("@ai-sdk/google");
const rest_1 = require("@octokit/rest");
const minimatch_1 = require("minimatch");
const diff_1 = require("diff");
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
 * 除外パスリスト (excludePaths) に該当しないファイルだけをフィルタする
 */
function filterFiles(files, excludePaths) {
    return files.filter((file) => {
        return !excludePaths.some((pattern) => (0, minimatch_1.minimatch)(file.filename, pattern, { matchBase: true }));
    });
}
function parseFiles(files) {
    return files.map((file) => {
        return Object.assign(Object.assign({}, file), { patch: (0, diff_1.parsePatch)(file.patch) });
    });
}
/**
 * AI に投げるプロンプトを生成する
 */
function createReviewPrompt({ prTitle, prBody, diffText, language, }) {
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
/** 実際に GitHub に投稿する関数 */
function realPostReviewComment(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const { octokit, owner, repo, pullNumber, reviewComment } = params;
        yield octokit.pulls.createReview({
            owner,
            repo,
            pull_number: pullNumber,
            body: reviewComment,
            event: "COMMENT",
        });
    });
}
/** dryRun用の疑似投稿関数 */
function dryRunPostReviewComment(params) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("--- DryRun Mode ---");
        console.log(`Would post review to ${params.owner}/${params.repo}#${params.pullNumber}`);
        console.log("Review Comment:");
        console.log(params.reviewComment);
    });
}
/**
 * Hunk を行番号付きの文字列にフォーマットする
 */
function formatHunkWithLineNumbers(hunk) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    // @@ -oldStart,oldLines +newStart,newLines @@ のヘッダー
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    // 各行に対して行番号を付与
    const formattedLines = hunk.lines.map((line) => {
        let lineNumbers = "";
        switch (line[0]) {
            case "-":
                // 削除行の場合: oldLine のみインクリメント
                lineNumbers = `${oldLine.toString().padStart(4, " ")}      `;
                oldLine++;
                break;
            case "+":
                // 追加行の場合: newLine のみインクリメント
                lineNumbers = `    ${newLine.toString().padStart(4, " ")}`;
                newLine++;
                break;
            default:
                // コンテキスト行の場合: oldLine/newLine 両方をインクリメント
                lineNumbers = `${oldLine.toString().padStart(4, " ")} ${newLine
                    .toString()
                    .padStart(4, " ")}`;
                oldLine++;
                newLine++;
                break;
        }
        return `${lineNumbers} | ${line}`;
    });
    return [hunkHeader, ...formattedLines].join("\n");
}
/**
 * ParsedDiff を使って読みやすい形に差分を整形する
 */
function createReadableDiffForFile(file) {
    const { filename, patch } = file;
    // "patch" is ParsedDiff[], so we can iterate through each diff
    const diffTexts = patch.map((diff, diffIndex) => {
        const headerInfo = [
            diff.index ? `Index: ${diff.index}` : "",
            diff.oldFileName ? `Old file: ${diff.oldFileName}` : "",
            diff.newFileName ? `New file: ${diff.newFileName}` : "",
        ]
            .filter(Boolean)
            .join("\n");
        // Format each hunk with line numbers
        const hunksText = diff.hunks
            .map((hunk) => formatHunkWithLineNumbers(hunk))
            .join("\n\n");
        return [
            `Diff #${diffIndex + 1} for ${filename}`,
            headerInfo,
            hunksText,
        ]
            .filter(Boolean)
            .join("\n") + "\n";
    });
    return diffTexts.join("\n");
}
/**
 * ParsedPullRequestFile[] をまとめて差分テキスト(diffText)に変換する
 */
function createParsedDiffText(parsedFiles) {
    return parsedFiles
        .map((file) => {
        return `---\nFile: ${file.filename}\n${createReadableDiffForFile(file)}`;
    })
        .join("\n");
}
function runReviewBotVercelAI(_a) {
    return __awaiter(this, arguments, void 0, function* ({ githubToken, owner, repo, pullNumber, excludePaths, language, modelCode, postReviewCommentFn, }) {
        try {
            const octokit = new rest_1.Octokit({ auth: githubToken });
            // 1. PRデータの取得
            const prData = yield fetchPullRequest(octokit, owner, repo, pullNumber);
            // 2. ファイル一覧の取得
            const filesData = yield fetchPullRequestFiles(octokit, owner, repo, pullNumber);
            // 3. 除外パスのフィルタリング
            const filteredFiles = filterFiles(filesData, excludePaths);
            // 4. ParsedPatch化
            const parsedFilesData = parseFiles(filteredFiles);
            // 5. 差分テキストの生成
            const diffText = createParsedDiffText(parsedFilesData);
            // 6. プロンプトの生成
            const userPrompt = createReviewPrompt({
                prTitle: prData.title,
                prBody: prData.body,
                diffText,
                language,
            });
            console.log("--- Prompt ---");
            console.log(userPrompt);
            // 7. AI にレビュー文を生成してもらう
            const { text: reviewComment } = yield (0, ai_1.generateText)({
                model: (0, google_1.google)(modelCode),
                prompt: userPrompt,
            });
            console.log("--- Review ---");
            console.log(reviewComment);
            // 8. GitHub にレビュー文を投稿
            yield postReviewCommentFn({
                octokit,
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
