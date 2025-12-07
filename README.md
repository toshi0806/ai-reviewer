[ENGLISH](./README.md) | [日本語](./README.ja.md)
# ai-reviewer

This is a PR review bot powered by generative AI.

## Usage

Place a file (e.g., `ai-reviewer.yml`) in the `.github/workflows` directory with the following content:

```yaml
name: "Run ai-reviewer"

permissions:
  pull-requests: write
  contents: read

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:

jobs:
  run-review:
    runs-on: ubuntu-latest
    steps:
      - name: Gemini Review Bot
        uses: toshi0806/ai-reviewer@v1
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          LANGUAGE: "Japanese"
          EXCLUDE_PATHS: "**/pnpm-lock.yaml"
          MODEL_CODE: "models/gemini-2.5-flash-lite"
```
Then, set your Google AI Studio Gemini API Key as GEMINI_API_KEY in your repository’s GitHub Secrets.

## Configuration
You can fine-tune how reviews are performed by setting the following environment variables:

| Environment Variable               | Required      | Default Value                      | 	Description                                                                                                                                                           |
|--------------------------|------------|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **EXCLUDE_PATHS**        | false       | -                                | 	Specify file paths or directories to exclude from reviews, separated by commas. Example: `src/vendor,**/dist/*`<br>Files matching these paths will not be reviewed.                                    |
| **LANGUAGE**             | false       | `English`                        | Specifies the language of the AI-generated comments (Example: `Japanese`, `English`).                                                                                                          |                                                                                       |
| **MODEL_CODE**           | false       | `models/gemini-2.5-flash`    | The Gemini model to use. Please set a valid model code that is available in AI Studio.                                                                                             |
| **USE_SINGLE_COMMENT_REVIEW** | false | `false`                          | When set to true, posts all review results in a single comment. When set to false, posts multiple comments directly on the relevant parts of the diff.                                                              |