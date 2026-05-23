import { generateText, generateObject, NoObjectGeneratedError } from "ai";
import { google } from "@ai-sdk/google";
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { minimatch } from "minimatch";
import { components } from "@octokit/openapi-types";
import { Hunk, ParsedDiff, parsePatch } from "diff";
import { z } from "zod"
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Generic retry function with exponential backoff
 */
async function withRetry<T>(
    operation: (attempt?: number) => Promise<T>,
    options: {
        maxAttempts: number;
        initialDelayMs: number;
        backoffFactor: number;
        retryableError: (error: any) => boolean;
        onRetry?: (attempt: number, error: any) => void;
    }
): Promise<T> {
    const { maxAttempts, initialDelayMs, backoffFactor, retryableError, onRetry } = options;

    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation(attempt);
        } catch (error) {
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

            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}

// OpenAPI型定義から直接Pull Requestの型を取得
type PullRequestData = components["schemas"]["pull-request"];
type PullRequestFile = components["schemas"]["diff-entry"];
type PullRequestFiles = PullRequestFile[];

type ParsedPullRequestFile = Omit<PullRequestFile, "patch"> & {
    patch: ParsedDiff[];
};

type GenerateReviewCommentFnParams = {
    modelCode: string;
    userPrompt: string;
}

type PostReviewCommentParams = {
    octokit: Octokit;
    owner: string;
    repo: string;
    pullNumber: number;
    reviewCommentContent: ReviewCommentContent
}

type PostReviewCommentFn = (params: PostReviewCommentParams) => Promise<void>;

interface ReviewBotOptions {
    githubToken: string;
    owner: string;
    repo: string;
    pullNumber: number;
    excludePaths: string[];
    language: string;
    modelCode: string;
    generateReviewCommentFn: GenerateReviewCommentFn
    postReviewCommentFn: PostReviewCommentFn;
}

type GenerateReviewCommentFn = (params: GenerateReviewCommentFnParams) => Promise<ReviewCommentContent>
type ReviewCommentContent = Pick<RestEndpointMethodTypes["pulls"]["createReview"]["parameters"], "body" | "comments">

/**
 * GitHub の PR 情報を取得
 */
export async function fetchPullRequest(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number
): Promise<PullRequestData> {
    const { data }: { data: PullRequestData } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
    });
    return data;
}

/**
 * GitHub の PR のファイル情報を取得
 */
export async function fetchPullRequestFiles(
    octokit: Octokit,
    owner: string,
    repo: string,
    pullNumber: number
): Promise<PullRequestFiles> {
    const { data }: { data: PullRequestFiles } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
    });
    return data;
}

/**
 * 除外パスリスト (excludePaths) に該当しないファイルだけをフィルタする
 */
export function filterFiles(
    files: PullRequestFiles,
    excludePaths: string[]
): PullRequestFiles {
    return files.filter((file) => {
        return !excludePaths.some((pattern) =>
            minimatch(file.filename, pattern, { matchBase: true })
        );
    });
}

export function parseFiles(files: PullRequestFiles): ParsedPullRequestFile[] {
    return files.map((file) => {
        if (!file.patch) {
            return { ...file, patch: [] };
        }
        return {
            ...file,
            patch: parsePatch(file.patch),
        };
    });
}

/**
 * AI に投げるプロンプトを生成する
 */
export function createReviewPrompt({
    prTitle,
    prBody,
    diffText,
    language,
}: {
    prTitle: string;
    prBody: string | null;
    diffText: string;
    language: string;
}): string {
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

/**
 * createReview の 422 レスポンスが「行解決失敗」由来かどうかを判定する。
 * 他の 422 (path 不正、権限、schema 変更等) を握り潰さないため、
 * フォールバックはこの判定が真の場合に限る。
 *
 * GitHub から返る errors は文字列配列の場合と
 * `{ resource, code, field, message }` 形式の場合がある。
 */
function isLineResolutionError(error: any): boolean {
    const errors = error?.response?.data?.errors ?? error?.errors;
    const candidates: string[] = [];
    if (Array.isArray(errors)) {
        for (const e of errors) {
            if (typeof e === "string") {
                candidates.push(e);
            } else if (e && typeof e === "object") {
                if (typeof e.message === "string") candidates.push(e.message);
                if (typeof e.code === "string") candidates.push(e.code);
            }
        }
    }
    if (typeof error?.response?.data?.message === "string") {
        candidates.push(error.response.data.message);
    }
    return candidates.some((c) => /line could not be resolved/i.test(c));
}

/** 実際に GitHub に投稿する関数 */
export const realPostReviewComment: PostReviewCommentFn = async (params) => {
    const { octokit, owner, repo, pullNumber, reviewCommentContent } = params;
    try {
        await octokit.pulls.createReview({
            owner,
            repo,
            pull_number: pullNumber,
            event: "COMMENT",
            ...reviewCommentContent,
        });
    } catch (error: any) {
        // GitHub の createReview API はリクエスト中の comments の一つでも
        // diff の範囲外行を指していると "Line could not be resolved" で
        // 422 を返し、全体（body 含む）を捨てる。inline コメントを諦めて
        // 本文だけでも投稿できるよう一度だけリトライする。それ以外の 422
        // (path 不正・権限・schema 変更等) は握り潰さず rethrow する。
        const status = error?.status ?? error?.response?.status;
        const hasInlineComments = (reviewCommentContent.comments?.length ?? 0) > 0;
        if (status === 422 && hasInlineComments && isLineResolutionError(error)) {
            const detail = error?.response?.data?.errors ?? error?.errors ?? error?.message;
            console.warn(
                "createReview rejected with 422 (line resolution); retrying without inline comments.",
                detail,
            );
            const fallbackBody =
                (reviewCommentContent.body ?? "") +
                "\n\n---\n" +
                "_Note: inline review comments were dropped because GitHub rejected them with 422 (\"Line could not be resolved\"). " +
                "This typically happens when the AI proposes a line number that does not appear on the right side of the diff._";
            await octokit.pulls.createReview({
                owner,
                repo,
                pull_number: pullNumber,
                event: "COMMENT",
                body: fallbackBody,
            });
        } else {
            throw error;
        }
    }
}

/** dryRun用の疑似投稿関数 */
export const dryRunPostReviewComment: PostReviewCommentFn = async (params) => {
    console.log("--- DryRun Mode ---");
    console.log(
        `Would post review to ${params.owner}/${params.repo}#${params.pullNumber}`
    );
    console.log("Review Comment:");
    console.log(params.reviewCommentContent);
}

/**
 * Hunk を行番号付きの文字列にフォーマットする
 */
function formatHunkWithLineNumbers(hunk: Hunk): string {
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
            case " ":
                // コンテキスト行: oldLine / newLine 両方をインクリメント
                lineNumbers = `${oldLine.toString().padStart(4, " ")} ${newLine
                    .toString()
                    .padStart(4, " ")}`;
                oldLine++;
                newLine++;
                break;
            default:
                // メタ行 (e.g. "\ No newline at end of file")。
                // 実在の行ではないのでカウンタは進めない。
                // AI が誤って line 番号を取らないよう数字は出さず空白で埋める。
                // computeValidRightSideLines も同じ前提で右側カウンタを
                // 進めないため、両者の行番号観が一致する。
                lineNumbers = "         ";
                break;
        }

        return `${lineNumbers} | ${line}`;
    });

    return [hunkHeader, ...formattedLines].join("\n");
}

/**
 * ParsedDiff を使って読みやすい形に差分を整形する
 */
function createReadableDiffForFile(file: ParsedPullRequestFile): string {
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
export function createParsedDiffText(parsedFiles: ParsedPullRequestFile[]): string {
    return parsedFiles
        .map((file) => {
            return `---\nFile: ${file.filename}\n${createReadableDiffForFile(file)}`;
        })
        .join("\n");
}

export const generateReviewCommentText: GenerateReviewCommentFn = async (params) => {
    const { modelCode, userPrompt } = params
    const { text } = await generateText({
        model: google(modelCode),
        prompt: userPrompt,
    });

    return { body: text }
}

export const generateReviewCommentObject: GenerateReviewCommentFn = async (params) => {
    const { modelCode, userPrompt } = params;

    // read testPrompt from a file named "testPrompt.txt` in the same directory
    // this file is comes from: https://github.com/Nasubikun/ai-reviewer/issues/1
    // const testPromptPath = path.join(process.cwd(), 'src', 'utils', 'testPrompt.txt');
    // const testPromptText = await fs.readFile(testPromptPath, 'utf-8');

    const commentSchema = z.object({
        path: z
            .string()
            .describe(
                "Specifies the relative path to the file where the review comment should be posted. " +
                "For example, 'src/index.js'. This path must match the file path in the Pull Request."
            ),
        body: z
            .string()
            .describe(
                "The content of the comment that will be displayed on the specified line of the Pull Request. " +
                "This message should clearly explain the suggestion or feedback related to that line."
            ),
        line: z
            .number()
            .int()
            .positive()
            .describe(
                "The 1-based line number where the comment is placed. " +
                "This must be a positive integer corresponding to the modified " +
                "(new) line in the diff or the final file."
            ),
        priority: z
            .enum(["HIGH", "MEDIUM", "LOW", "POSITIVE"])
            .describe(
                "The priority of this fix. For suggestions, set its priority as like 'HIGH', 'MEDIUM', or 'LOW'. For positive comments, it should be 'POSITIVE'."
            ),
    });

    const reviewSchema = z.object({
        body: z
            .string()
            .describe(
                "Represents the overall body text of the review, providing a summary or context for the accompanying line-level comments."
            ),
        comments: z.array(commentSchema),
    });

    try {
        // Use the retry mechanism for handling NoObjectGeneratedError
        const { object } = await withRetry(
            async (attempt = 1) => {
                return await generateObject({
                    schema: reviewSchema,
                    model: google(modelCode),
                    prompt: userPrompt,
                    // Use temperature 0 for first attempt, 0.5 for retries
                    temperature: attempt === 1 ? 0 : 0.5
                });
            },
            {
                maxAttempts: 3,
                initialDelayMs: 2000,
                backoffFactor: 1.5,
                retryableError: (error) => {
                    return error instanceof NoObjectGeneratedError;
                },
                onRetry: (attempt, error) => {
                    console.log(`Retry attempt ${attempt} after error: ${error.message}`);
                }
            }
        );

        const iconMap = {
            "HIGH": ":rotating_light:",
            "MEDIUM": ":warning:",
            "LOW": ":information_source:",
            "POSITIVE": ":sparkles:"
        } as const;

        const priorityOrder = {
            "HIGH": 0,
            "MEDIUM": 1,
            "LOW": 2,
            "POSITIVE": 999
        } as const;

        return {
            body: object.body,
            comments: object.comments
                .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
                .map((comment) => {
                    return {
                        ...comment,
                        body: `${iconMap[comment.priority]} [${comment.priority}] ${comment.body}`,
                        priority: undefined,
                    };
                }),
        };
    } catch (error) {
        // If object generation fails after all retries, fall back to text generation
        console.log("Failed to generate structured review after all retries. Falling back to text generation.");
        return await generateReviewCommentText(params);
    }
}

type InlineReviewComment = {
    path: string;
    line: number;
    body: string;
};

/**
 * 各ファイルについて、GitHub の createReview API が
 * インラインコメントのターゲットとして受け付ける
 * "右側 (newStart 以降の)" 行番号集合を計算する。
 *
 * GitHub の Reviews API は line が hunk 上の `+` または ` ` 行に
 * 落ちないと "Line could not be resolved" で 422 を返し、
 * 一件でも違反があると body を含む review 全体が棄却される。
 */
export function computeValidRightSideLines(
    files: ParsedPullRequestFile[],
): Map<string, Set<number>> {
    const result = new Map<string, Set<number>>();
    for (const file of files) {
        const validLines = new Set<number>();
        for (const diff of file.patch) {
            for (const hunk of diff.hunks) {
                let newLine = hunk.newStart;
                for (const rawLine of hunk.lines) {
                    const prefix = rawLine[0];
                    // 右側に存在する行 ('+' 追加 / ' ' 文脈) のみが
                    // インラインコメントの有効なターゲットになり、
                    // 同時に右側の行カウンタを進める。
                    // '-' (削除) は右側に出ない。
                    // '\' (e.g. "\ No newline at end of file") は
                    // 行ではなくメタ情報なのでカウンタも進めない。
                    if (prefix === "+" || prefix === " ") {
                        validLines.add(newLine);
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
export function partitionCommentsByLineValidity(
    comments: InlineReviewComment[],
    validLines: Map<string, Set<number>>,
): { kept: InlineReviewComment[]; dropped: InlineReviewComment[] } {
    const kept: InlineReviewComment[] = [];
    const dropped: InlineReviewComment[] = [];
    for (const comment of comments) {
        const allowed = validLines.get(comment.path);
        if (allowed && allowed.has(comment.line)) {
            kept.push(comment);
        } else {
            dropped.push(comment);
        }
    }
    return { kept, dropped };
}

/**
 * AI 返却の review 内容を、現在の diff に基づいて
 * 投稿可能な形に整形する。落とした件数を body の脚注に追記。
 */
function sanitizeReviewCommentContent(
    reviewCommentContent: ReviewCommentContent,
    parsedFiles: ParsedPullRequestFile[],
): ReviewCommentContent {
    const comments = reviewCommentContent.comments;
    if (!comments || comments.length === 0) {
        return reviewCommentContent;
    }

    const validLines = computeValidRightSideLines(parsedFiles);
    // GitHub の line は正の有限整数のみ受け付ける。Zod の `.int()` で
    // 入口は塞いだが、フォールバック生成や将来のスキーマ変更で
    // NaN / Infinity / 小数が流入しても弾けるよう投稿直前にも検証する。
    const candidates = comments.filter(
        (c): c is InlineReviewComment =>
            typeof c.path === "string" &&
            typeof c.body === "string" &&
            typeof c.line === "number" &&
            Number.isInteger(c.line) &&
            c.line > 0,
    );
    const malformedCount = comments.length - candidates.length;
    const { kept, dropped } = partitionCommentsByLineValidity(candidates, validLines);
    const totalDropped = malformedCount + dropped.length;

    if (totalDropped === 0) {
        return reviewCommentContent;
    }

    if (malformedCount > 0) {
        console.warn(
            `Dropping ${malformedCount} AI-generated inline comment(s) with malformed path/line/body fields.`,
        );
    }
    if (dropped.length > 0) {
        console.warn(
            `Dropping ${dropped.length} AI-generated inline comment(s) that target lines outside the diff:`,
            dropped.map((c) => `${c.path}:${c.line}`),
        );
    }

    const note =
        `\n\n---\n_Note: ${totalDropped} AI-generated inline comment(s) were skipped (either malformed or targeting lines outside the diff)._`;
    return {
        ...reviewCommentContent,
        body: (reviewCommentContent.body ?? "") + note,
        comments: kept,
    };
}

export async function runReviewBotVercelAI({
    githubToken,
    owner,
    repo,
    pullNumber,
    excludePaths,
    language,
    modelCode,
    generateReviewCommentFn,
    postReviewCommentFn,
}: ReviewBotOptions) {
    try {
        const octokit = new Octokit({ auth: githubToken });

        // 1. PRデータの取得
        const prData = await fetchPullRequest(octokit, owner, repo, pullNumber);

        // 2. ファイル一覧の取得
        const filesData = await fetchPullRequestFiles(octokit, owner, repo, pullNumber);

        // 3. 除外パスのフィルタリング
        const filteredFiles = filterFiles(filesData, excludePaths);

        // 4. ParsedPatch化
        const parsedFilesData: ParsedPullRequestFile[] = parseFiles(filteredFiles)

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
            reviewCommentContent = await generateReviewCommentFn({ modelCode, userPrompt });
        } catch (error) {
            console.error("Failed to generate review comment after retries:", error);
            throw error; // Re-throw to be caught by the outer try-catch
        }

        console.log("--- Review ---");
        console.log(reviewCommentContent);

        // 7.5 AI が返した行番号が diff 上に存在しないと
        // createReview が 422 で review 全体を棄却するため、事前に間引く。
        const sanitizedContent = sanitizeReviewCommentContent(
            reviewCommentContent,
            parsedFilesData,
        );

        // 8. GitHub にレビュー文を投稿
        await postReviewCommentFn({
            octokit,
            owner,
            repo,
            pullNumber,
            reviewCommentContent: sanitizedContent,
        });

    } catch (error) {
        console.error("Error in runReviewBotVercelAI:", error);
        throw error;
    }
}
