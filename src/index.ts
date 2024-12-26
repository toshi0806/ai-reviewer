import dotenv from 'dotenv';
import { generateText } from "ai"
import { google } from "@ai-sdk/google"
import { Octokit } from '@octokit/rest';

dotenv.config();
// 1. 環境変数の取得
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OWNER = process.env.GITHUB_OWNER || 'your-github-owner';
const REPO = process.env.GITHUB_REPO || 'your-github-repo';
const PR_NUMBER = Number(process.env.GITHUB_PR_NUMBER) || 1;

const octokit = new Octokit({
    auth: GITHUB_TOKEN,
});

async function runReviewBotVercelAI() {
    try {
        const { data: prData } = await octokit.pulls.get({
            owner: OWNER,
            repo: REPO,
            pull_number: PR_NUMBER,
        });

        const { data: filesData } = await octokit.pulls.listFiles({
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

        const { text: reviewComment } = await generateText({
            model: google("models/gemini-1.5-pro-latest"),
            prompt: userPrompt
        })



        console.log('--- 自動生成されたコードレビュー (vercel/ai) ---');
        console.log(reviewComment);

        await octokit.pulls.createReview({
            owner: OWNER,
            repo: REPO,
            pull_number: PR_NUMBER,
            body: reviewComment,
            event: "COMMENT",
        });


    } catch (error) {
        console.error('Error in runReviewBotVercelAI:', error);
    }
}

runReviewBotVercelAI();
