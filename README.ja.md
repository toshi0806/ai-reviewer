[ENGLISH](./README.md) | [日本語](./README.ja.md)
# ai-reviewer

生成AIによるPRレビューbotです。

## 使い方

`.github/workflows`に`ai-reviewer.yml`など任意の名前で以下のファイルを配置します。
```
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
        uses: Nasubikun/ai-reviewer@v1
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          LANGUAGE: "Japanese"
          EXCLUDE_PATHS: "**/pnpm-lock.yaml"
```
Github Secretsに`GEMINI_API_KEY`としてGoogle AI StudioのGemini API Keyを設定します。

## 設定

以下の環境変数を設定することで、レビューの挙動を細かく制御できます。

| 環境変数名               | Required      | デフォルト値                      | 説明                                                                                                                                                           |
|--------------------------|------------|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **EXCLUDE_PATHS**        | false       | -                                | レビューから除外したいファイルパスやディレクトリをカンマ区切りで指定します。例: `src/vendor,**/dist/*`<br>ここで指定されたパスに該当するファイルはレビューの対象外となります。                                    |
| **LANGUAGE**             | false       | `English`                        | AIが生成するコメントの言語を指定します。例: `Japanese`, `English`など。                                                                                                          |                                                                                       |
| **MODEL_CODE**           | false       | `models/gemini-2.0-flash-exp`    | 使用するGeminiモデルの指定です。AI Studioで利用できるモデルコードを設定してください。                                                                                             |
| **USE_SINGLE_COMMENT_REVIEW** | false | `false`                          | `true`に設定すると、1つのコメントにまとめてレビュー結果を投稿します。<br>`false`の場合は差分にコメントをつける形で複数に分けて投稿します。                                                              |