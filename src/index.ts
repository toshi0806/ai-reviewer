import { generateText } from "ai"
import { google } from "@ai-sdk/google"
import { Octokit } from '@octokit/rest';
import { minimatch } from "minimatch";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER
const REPO = process.env.GITHUB_REPO
const EXCLUDE_PATHS = process.env.EXCLUDE_PATHS?.split(',').map(p => p.trim()) || [];
const LANGUAGE = process.env.LANGUAGE || "English"
const PR_NUMBER = Number(process.env.GITHUB_PR_NUMBER) || 1;
const MODEL_CODE = process.env.MODEL_CODE || "models/gemini-2.0-flash-exp"


const octokit = new Octokit({
    auth: GITHUB_TOKEN,
});

async function runReviewBotVercelAI() {
    if (!GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN is missing")
    }
    if (!OWNER) {
        throw new Error("OWNER is missing")
    }
    if (!REPO) {
        throw new Error("REPO is missing")
    }
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

        const filteredFiles = filesData.filter(file => {
            return !EXCLUDE_PATHS.some(pattern =>
                minimatch(file.filename, pattern, { matchBase: true })
            );
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
        console.log("--- Prompt ---")
        console.log(userPrompt)

        const { text: reviewComment } = await generateText({
            model: google(MODEL_CODE),
            prompt: userPrompt
        })



        console.log('--- Review ---');
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
