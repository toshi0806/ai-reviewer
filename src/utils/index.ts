// reviewBot.js
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { Octokit } from "@octokit/rest";
import { minimatch } from "minimatch";
import { components } from "@octokit/openapi-types";

// OpenAPI型定義から直接Pull Requestの型を取得
type PullRequestData = components["schemas"]["pull-request"];
type PullRequestFiles = components["schemas"]["diff-entry"][];

/**
 * GitHub の PR 情報を取得
 */
export async function fetchPullRequest(octokit: Octokit, owner: string, repo: string, pullNumber: number): Promise<PullRequestData> {
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
export async function fetchPullRequestFiles(octokit: Octokit, owner: string, repo: string, pullNumber: number): Promise<PullRequestFiles> {
    const { data }: { data: PullRequestFiles } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
    });
    return data;
}

/**
 * 除外パスリスト (EXCLUDE_PATHS) に該当しないファイルだけをフィルタする
 */
export function filterFiles(files: PullRequestFiles, excludePaths: string[]) {
    return files.filter(file => {
        return !excludePaths.some(pattern =>
            minimatch(file.filename, pattern, { matchBase: true })
        );
    });
}

/**
 * 差分テキスト(diffText) を生成する
 */
export function createDiffText(files: PullRequestFiles) {
    return files
        .map(file => `---\nFile: ${file.filename}\nPatch:\n${file.patch}`)
        .join("\n\n");
}

/**
 * AI に投げるプロンプトを生成する
 */
export function createReviewPrompt({ prTitle, prBody, diffText, language }: { prTitle: string, prBody: string | null, diffText: string, language: string }) {
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

type PostReviewComment = (params: {
    octokit: Octokit;
    owner: string;
    repo: string;
    pullNumber: number;
    reviewComment: string;
}) => Promise<void>;

interface ReviewBotOptions {
    githubToken: string;
    owner: string;
    repo: string;
    pullNumber: number;
    excludePaths: string[];
    language: string;
    modelCode: string;
    postReviewCommentFn: PostReviewComment;
}

/** 実際に GitHub に投稿する関数 */
export async function realPostReviewComment(params: {
    octokit: Octokit;
    owner: string;
    repo: string;
    pullNumber: number;
    reviewComment: string;
}) {
    const { octokit, owner, repo, pullNumber, reviewComment } = params;
    await octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        body: reviewComment,
        event: "COMMENT",
    });
}

/** 乾燥実行(dryRun)用の疑似投稿関数 */
export async function dryRunPostReviewComment(params: {
    octokit: Octokit;
    owner: string;
    repo: string;
    pullNumber: number;
    reviewComment: string;
}) {
    console.log("--- DryRun Mode ---");
    console.log(`Would post review to ${params.owner}/${params.repo}#${params.pullNumber}`);
    console.log("Review Comment:");
    console.log(params.reviewComment);
}

/**
 * メイン処理
 */
export async function runReviewBotVercelAI({
    githubToken,
    owner,
    repo,
    pullNumber,
    excludePaths,
    language,
    modelCode,
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
        const { text: reviewComment } = await generateText({
            model: google(modelCode),
            prompt: userPrompt,
        });

        console.log("--- Review ---");
        console.log(reviewComment);

        // 7. GitHub にレビュー文を投稿
        await postReviewCommentFn({
            octokit,
            owner,
            repo,
            pullNumber,
            reviewComment,
        });

    } catch (error) {
        console.error("Error in runReviewBotVercelAI:", error);
    }
}
