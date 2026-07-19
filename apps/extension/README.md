# FlawFerret

## Usage
1. Build the extension from the FlawFerret2 repo root:

```bash
pnpm --filter @flawferret2/extension build
```

2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `dist/` folder at `/Users/robertmichaels/Documents/code/flawferret2/apps/extension/dist`.
6. Navigate to any regular web page and right-click a target element.
7. Right-click any element on the page and choose **FlawFerret**.
8. The overlay opens with captured context; edit text, generate with AI, create a Jira ticket, or open a FlawFerret2 Playwright job.

## Jira Integration
1. Open the extension settings: `chrome://extensions` -> **Details** -> **Extension options**.
2. Enter your Jira base URL, email, and API token.
3. In the overlay, select a project and click **Create Jira Ticket**.

## AI Scenario Generation
1. Run the backend from the separate `flawferretAIserver` project.
2. In extension options, set **AI Server URL** (for local, use `http://localhost:8787`).
3. Choose **AI Provider**:
   - Ollama with model `codellama` and URL `http://localhost:11434`.
   - OpenAI (requires `OPENAI_API_KEY` on the server).
4. Use **Generate with AI** in the overlay to create a full Scenario.

## Tab Recording (Preview)
1. In the overlay, click **Record Tab**.
2. The overlay hides and a small **Recording** control appears.
3. Click **Stop** to return to the overlay with a recording preview.
4. When creating the Jira ticket, the recording is attached automatically.
