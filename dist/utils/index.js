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
exports.generateReviewCommentObject = exports.generateReviewCommentText = exports.dryRunPostReviewComment = exports.realPostReviewComment = void 0;
exports.fetchPullRequest = fetchPullRequest;
exports.fetchPullRequestFiles = fetchPullRequestFiles;
exports.filterFiles = filterFiles;
exports.parseFiles = parseFiles;
exports.createReviewPrompt = createReviewPrompt;
exports.createParsedDiffText = createParsedDiffText;
exports.computeValidRightSideLines = computeValidRightSideLines;
exports.partitionCommentsByLineValidity = partitionCommentsByLineValidity;
exports.runReviewBotVercelAI = runReviewBotVercelAI;
const ai_1 = require("ai");
const google_1 = require("@ai-sdk/google");
const rest_1 = require("@octokit/rest");
const minimatch_1 = require("minimatch");
const diff_1 = require("diff");
const zod_1 = require("zod");
/**
 * Generic retry function with exponential backoff
 */
function withRetry(operation, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const { maxAttempts, initialDelayMs, backoffFactor, retryableError, onRetry } = options;
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return yield operation(attempt);
            }
            catch (error) {
                lastError = error;
                if (!retryableError(error)) {
                    throw error; // Not retryable, rethrow immediately
                }
                if (attempt >= maxAttempts) {
                    break; // Will throw the last error after the loop
                }
                const delayMs = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
                if (onRetry) {
                    onRetry(attempt, error);
                }
                yield new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        throw lastError;
    });
}
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
        if (!file.patch) {
            return Object.assign(Object.assign({}, file), { patch: [] });
        }
        return Object.assign(Object.assign({}, file), { patch: (0, diff_1.parsePatch)(file.patch) });
    });
}
/**
 * AI に投げるプロンプトを生成する
 */
function createReviewPrompt({ prTitle, prBody, diffText, language, }) {
    return `
You're a sophisticated software engineer.
Please review the code changes in the following Pull Request and point out potential problems or areas for improvement only if they are significant.
Important rules about the diff format:
- Lines that begin with "-" are lines that have been **removed** in this Pull Request.
- Lines that begin with "+" are lines that have been **added** in this Pull Request.
- Lines that begin with a space " " are context lines, which have not changed.

Review guidelines:
- Ignore changes that only involve whitespace, indentation, or formatting that do not affect the code's behavior.
- Do not add any review comments for trivial or non-impactful changes (e.g., variable-name changes that do not affect logic).
- For suggestions, assign a priority. Only the following labels are allowed: HIGH, MEDIUM, LOW, or POSITIVE.
- Use type=POSITIVE only for changes that bring a clear, significant improvement to readability, performance, or maintainability. If a change is merely “not a problem,” do not comment on it.
- Your review must be written in ${language}.


Pull Request Title: ${prTitle}
Pull Request Body: ${prBody}

Diffs:
${diffText}
`;
}
/** 実際に GitHub に投稿する関数 */
const realPostReviewComment = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const { octokit, owner, repo, pullNumber, reviewCommentContent } = params;
    try {
        yield octokit.pulls.createReview(Object.assign({ owner,
            repo, pull_number: pullNumber, event: "COMMENT" }, reviewCommentContent));
    }
    catch (error) {
        // GitHub の createReview API はリクエスト中の comments の一つでも
        // diff の範囲外行を指していると "Line could not be resolved" で
        // 422 を返し、全体（body 含む）を捨てる。inline コメントを諦めて
        // 本文だけでも投稿できるよう一度だけリトライする。
        const status = (_a = error === null || error === void 0 ? void 0 : error.status) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status;
        const hasInlineComments = ((_d = (_c = reviewCommentContent.comments) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0) > 0;
        if (status === 422 && hasInlineComments) {
            const detail = (_h = (_g = (_f = (_e = error === null || error === void 0 ? void 0 : error.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.errors) !== null && _g !== void 0 ? _g : error === null || error === void 0 ? void 0 : error.errors) !== null && _h !== void 0 ? _h : error === null || error === void 0 ? void 0 : error.message;
            console.warn("createReview rejected with 422; retrying without inline comments.", detail);
            const fallbackBody = ((_j = reviewCommentContent.body) !== null && _j !== void 0 ? _j : "") +
                "\n\n---\n" +
                "_Note: inline review comments were dropped because GitHub rejected them with 422 (\"Line could not be resolved\"). " +
                "This typically happens when the AI proposes a line number that does not appear on the right side of the diff._";
            yield octokit.pulls.createReview({
                owner,
                repo,
                pull_number: pullNumber,
                event: "COMMENT",
                body: fallbackBody,
            });
        }
        else {
            throw error;
        }
    }
});
exports.realPostReviewComment = realPostReviewComment;
/** dryRun用の疑似投稿関数 */
const dryRunPostReviewComment = (params) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("--- DryRun Mode ---");
    console.log(`Would post review to ${params.owner}/${params.repo}#${params.pullNumber}`);
    console.log("Review Comment:");
    console.log(params.reviewCommentContent);
});
exports.dryRunPostReviewComment = dryRunPostReviewComment;
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
                lineNumbers = `     ${newLine.toString().padStart(4, " ")}`;
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
const generateReviewCommentText = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const { modelCode, userPrompt } = params;
    const { text } = yield (0, ai_1.generateText)({
        model: (0, google_1.google)(modelCode),
        prompt: userPrompt,
    });
    return { body: text };
});
exports.generateReviewCommentText = generateReviewCommentText;
const generateReviewCommentObject = (params) => __awaiter(void 0, void 0, void 0, function* () {
    const { modelCode, userPrompt } = params;
    // read testPrompt from a file named "testPrompt.txt` in the same directory
    // this file is comes from: https://github.com/Nasubikun/ai-reviewer/issues/1
    // const testPromptPath = path.join(process.cwd(), 'src', 'utils', 'testPrompt.txt');
    // const testPromptText = await fs.readFile(testPromptPath, 'utf-8');
    const commentSchema = zod_1.z.object({
        path: zod_1.z
            .string()
            .describe("Specifies the relative path to the file where the review comment should be posted. " +
            "For example, 'src/index.js'. This path must match the file path in the Pull Request."),
        body: zod_1.z
            .string()
            .describe("The content of the comment that will be displayed on the specified line of the Pull Request. " +
            "This message should clearly explain the suggestion or feedback related to that line."),
        line: zod_1.z
            .number()
            .positive()
            .describe("The 1-based line number where the comment is placed. " +
            "This corresponds to the modified (new) line in the diff or the final file."),
        priority: zod_1.z
            .enum(["HIGH", "MEDIUM", "LOW", "POSITIVE"])
            .describe("The priority of this fix. For suggestions, set its priority as like 'HIGH', 'MEDIUM', or 'LOW'. For positive comments, it should be 'POSITIVE'."),
    });
    const reviewSchema = zod_1.z.object({
        body: zod_1.z
            .string()
            .describe("Represents the overall body text of the review, providing a summary or context for the accompanying line-level comments."),
        comments: zod_1.z.array(commentSchema),
    });
    try {
        // Use the retry mechanism for handling NoObjectGeneratedError
        const { object } = yield withRetry((...args_1) => __awaiter(void 0, [...args_1], void 0, function* (attempt = 1) {
            return yield (0, ai_1.generateObject)({
                schema: reviewSchema,
                model: (0, google_1.google)(modelCode),
                prompt: userPrompt,
                // Use temperature 0 for first attempt, 0.5 for retries
                temperature: attempt === 1 ? 0 : 0.5
            });
        }), {
            maxAttempts: 3,
            initialDelayMs: 2000,
            backoffFactor: 1.5,
            retryableError: (error) => {
                return error instanceof ai_1.NoObjectGeneratedError;
            },
            onRetry: (attempt, error) => {
                console.log(`Retry attempt ${attempt} after error: ${error.message}`);
            }
        });
        const iconMap = {
            "HIGH": ":rotating_light:",
            "MEDIUM": ":warning:",
            "LOW": ":information_source:",
            "POSITIVE": ":sparkles:"
        };
        const priorityOrder = {
            "HIGH": 0,
            "MEDIUM": 1,
            "LOW": 2,
            "POSITIVE": 999
        };
        return {
            body: object.body,
            comments: object.comments
                .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
                .map((comment) => {
                return Object.assign(Object.assign({}, comment), { body: `${iconMap[comment.priority]} [${comment.priority}] ${comment.body}`, priority: undefined });
            }),
        };
    }
    catch (error) {
        // If object generation fails after all retries, fall back to text generation
        console.log("Failed to generate structured review after all retries. Falling back to text generation.");
        return yield (0, exports.generateReviewCommentText)(params);
    }
});
exports.generateReviewCommentObject = generateReviewCommentObject;
/**
 * 各ファイルについて、GitHub の createReview API が
 * インラインコメントのターゲットとして受け付ける
 * "右側 (newStart 以降の)" 行番号集合を計算する。
 *
 * GitHub の Reviews API は line が hunk 上の `+` または ` ` 行に
 * 落ちないと "Line could not be resolved" で 422 を返し、
 * 一件でも違反があると body を含む review 全体が棄却される。
 */
function computeValidRightSideLines(files) {
    const result = new Map();
    for (const file of files) {
        const validLines = new Set();
        for (const diff of file.patch) {
            for (const hunk of diff.hunks) {
                let newLine = hunk.newStart;
                for (const rawLine of hunk.lines) {
                    const prefix = rawLine[0];
                    if (prefix === "+" || prefix === " ") {
                        validLines.add(newLine);
                    }
                    if (prefix !== "-") {
                        newLine++;
                    }
                }
            }
        }
        result.set(file.filename, validLines);
    }
    return result;
}
/**
 * AI が生成したインラインコメントを diff 上で投稿可能なものに絞り込み、
 * 不可なものは別配列で返す。
 */
function partitionCommentsByLineValidity(comments, validLines) {
    const kept = [];
    const dropped = [];
    for (const comment of comments) {
        const allowed = validLines.get(comment.path);
        if (allowed && allowed.has(comment.line)) {
            kept.push(comment);
        }
        else {
            dropped.push(comment);
        }
    }
    return { kept, dropped };
}
/**
 * AI 返却の review 内容を、現在の diff に基づいて
 * 投稿可能な形に整形する。落とした件数を body の脚注に追記。
 */
function sanitizeReviewCommentContent(reviewCommentContent, parsedFiles) {
    var _a;
    const comments = reviewCommentContent.comments;
    if (!comments || comments.length === 0) {
        return reviewCommentContent;
    }
    const validLines = computeValidRightSideLines(parsedFiles);
    const candidates = comments.filter((c) => typeof c.path === "string" &&
        typeof c.line === "number" &&
        typeof c.body === "string");
    const { kept, dropped } = partitionCommentsByLineValidity(candidates, validLines);
    if (dropped.length === 0) {
        return reviewCommentContent;
    }
    console.warn(`Dropping ${dropped.length} AI-generated inline comment(s) that target lines outside the diff:`, dropped.map((c) => `${c.path}:${c.line}`));
    const note = `\n\n---\n_Note: ${dropped.length} AI-generated inline comment(s) were skipped because they targeted lines outside the diff._`;
    return Object.assign(Object.assign({}, reviewCommentContent), { body: ((_a = reviewCommentContent.body) !== null && _a !== void 0 ? _a : "") + note, comments: kept });
}
function runReviewBotVercelAI(_a) {
    return __awaiter(this, arguments, void 0, function* ({ githubToken, owner, repo, pullNumber, excludePaths, language, modelCode, generateReviewCommentFn, postReviewCommentFn, }) {
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
            // 7. AI にレビュー文を生成してもらう (with improved error handling)
            let reviewCommentContent;
            try {
                reviewCommentContent = yield generateReviewCommentFn({ modelCode, userPrompt });
            }
            catch (error) {
                console.error("Failed to generate review comment after retries:", error);
                throw error; // Re-throw to be caught by the outer try-catch
            }
            console.log("--- Review ---");
            console.log(reviewCommentContent);
            // 7.5 AI が返した行番号が diff 上に存在しないと
            // createReview が 422 で review 全体を棄却するため、事前に間引く。
            const sanitizedContent = sanitizeReviewCommentContent(reviewCommentContent, parsedFilesData);
            // 8. GitHub にレビュー文を投稿
            yield postReviewCommentFn({
                octokit,
                owner,
                repo,
                pullNumber,
                reviewCommentContent: sanitizedContent,
            });
        }
        catch (error) {
            console.error("Error in runReviewBotVercelAI:", error);
            throw error;
        }
    });
}
