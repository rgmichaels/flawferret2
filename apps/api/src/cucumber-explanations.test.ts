import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLocalScenarioExplanation } from "./cucumber-explanations.js";

describe("cucumber scenario explanations", () => {
  it("summarizes scenario intent without a model response", () => {
    const explanation = buildLocalScenarioExplanation({
      scenario: {
        keyword: "Scenario",
        line: 4,
        name: "Context Menu loads and exercises expected behavior",
        steps: [
          {
            keyword: "Given",
            line: 5,
            matchedDefinition: null,
            text: "I am on the home page",
          },
          {
            keyword: "When",
            line: 6,
            matchedDefinition: null,
            text: 'I open the "Context Menu" example',
          },
          {
            keyword: "Then",
            line: 7,
            matchedDefinition: null,
            text: "the Context Menu page should load",
          },
          {
            keyword: "And",
            line: 8,
            matchedDefinition: null,
            text: "I exercise the Context Menu page",
          },
        ],
        tags: ["@smoke"],
        unmatchedStepCount: 0,
      },
    });

    assert.match(explanation, /Context Menu loads/);
    assert.match(explanation, /Given "I am on the home page": no implementation details found/);
    assert.match(explanation, /I open the "Context Menu" example/);
    assert.match(explanation, /And "I exercise the Context Menu page": no implementation details found/);
  });

  it("summarizes behavior from matched step and page object source", () => {
    const explanation = buildLocalScenarioExplanation({
      relatedSources: [
        {
          path: "src/pages/ContextMenuPage.ts",
          source: [
            "export class ContextMenuPage {",
            "  async assertLoaded() {",
            "    await this.expectH3ToBe('Context Menu');",
            "    const paragraphs = this.page.locator('#content p');",
            "    await expect(paragraphs).toHaveCount(2);",
            "    await expect(paragraphs.nth(0)).toHaveText('Context menu items are custom additions.');",
            "  }",
            "  async triggerContextMenuAlert() {",
            "    const box = this.page.locator('#hot-spot');",
            "    await expect(box).toBeVisible();",
            "    this.page.once('dialog', async (d) => {",
            "      expect(d.message()).toContain('You selected a context menu');",
            "      await d.accept();",
            "    });",
            "    await box.click({ button: 'right' });",
            "  }",
            "  async exercise() {",
            "    await this.triggerContextMenuAlert();",
            "  }",
            "}",
          ].join("\n"),
        },
      ],
      scenario: {
        keyword: "Scenario",
        line: 4,
        name: "Context Menu loads and exercises expected behavior",
        steps: [
          {
            keyword: "Then",
            line: 7,
            matchedDefinition: {
              expression: "I exercise the Context Menu page",
              line: 16,
              path: "src/steps/contextMenu.steps.ts",
            },
            text: "I exercise the Context Menu page",
          },
        ],
        tags: ["@smoke"],
        unmatchedStepCount: 0,
      },
      snippets: [
        {
          definitionSource: [
            "Then('I exercise the Context Menu page', async function () {",
            "  const po = new ContextMenuPage(this.page);",
            "  await po.exercise();",
            "});",
          ].join("\n"),
          fullSource: [
            "import { ContextMenuPage } from '../pages/ContextMenuPage';",
            "Then('I exercise the Context Menu page', async function () {",
            "  const po = new ContextMenuPage(this.page);",
            "  await po.exercise();",
            "});",
          ].join("\n"),
          line: 16,
          path: "src/steps/contextMenu.steps.ts",
          source: "16: Then('I exercise the Context Menu page', async function () {",
        },
      ],
    });

    assert.match(explanation, /Right-clicks the target element/);
    assert.match(explanation, /browser dialog/);
    assert.match(explanation, /You selected a context menu/);
  });

  it("calls out broad scenarios that combine load checks and interaction checks", () => {
    const explanation = buildLocalScenarioExplanation({
      relatedSources: [
        {
          path: "src/pages/ContextMenuPage.ts",
          source: [
            "export class ContextMenuPage {",
            "  async assertLoaded() {",
            "    await this.expectH3ToBe('Context Menu');",
            "    await expect(this.page.locator('#content p')).toHaveCount(2);",
            "  }",
            "  async triggerContextMenuAlert() {",
            "    await expect(this.page.locator('#hot-spot')).toBeVisible();",
            "    this.page.once('dialog', async (d) => {",
            "      expect(d.message()).toContain('You selected a context menu');",
            "      await d.accept();",
            "    });",
            "    await this.page.locator('#hot-spot').click({ button: 'right' });",
            "  }",
            "  async exercise() { await this.triggerContextMenuAlert(); }",
            "}",
          ].join("\n"),
        },
        {
          path: "src/pages/HomePage.ts",
          source: [
            "export class HomePage {",
            "  async openExample() {",
            "    const link = this.page.getByRole('link', { name: 'Context Menu', exact: true });",
            "    await expect(link).toBeVisible();",
            "    await Promise.all([this.page.waitForNavigation(), link.click()]);",
            "  }",
            "}",
          ].join("\n"),
        },
      ],
      scenario: {
        keyword: "Scenario",
        line: 4,
        name: "Context Menu loads and exercises expected behavior",
        steps: [
          {
            keyword: "When",
            line: 6,
            matchedDefinition: {
              expression: "I open the {string} example",
              line: 40,
              path: "src/steps/site.steps.ts",
            },
            text: 'I open the "Context Menu" example',
          },
          {
            keyword: "Then",
            line: 7,
            matchedDefinition: {
              expression: "the Context Menu page should load",
              line: 11,
              path: "src/steps/contextMenu.steps.ts",
            },
            text: "the Context Menu page should load",
          },
          {
            keyword: "And",
            line: 8,
            matchedDefinition: {
              expression: "I exercise the Context Menu page",
              line: 16,
              path: "src/steps/contextMenu.steps.ts",
            },
            text: "I exercise the Context Menu page",
          },
        ],
        tags: ["@smoke"],
        unmatchedStepCount: 0,
      },
      snippets: [
        {
          definitionSource: [
            "When('I open the {string} example', async function () {",
            "  const home = new HomePage(this.page);",
            "  await home.openExample(name);",
            "});",
          ].join("\n"),
          fullSource: "import { HomePage } from '../pages/HomePage';",
          line: 40,
          path: "src/steps/site.steps.ts",
          source: "40: When('I open the {string} example', async function () {",
        },
        {
          definitionSource: [
            "Then('the Context Menu page should load', async function () {",
            "  const po = new ContextMenuPage(this.page);",
            "  await po.assertLoaded();",
            "});",
          ].join("\n"),
          fullSource: "import { ContextMenuPage } from '../pages/ContextMenuPage';",
          line: 11,
          path: "src/steps/contextMenu.steps.ts",
          source: "11: Then('the Context Menu page should load', async function () {",
        },
        {
          definitionSource: [
            "Then('I exercise the Context Menu page', async function () {",
            "  const po = new ContextMenuPage(this.page);",
            "  await po.exercise();",
            "});",
          ].join("\n"),
          fullSource: "import { ContextMenuPage } from '../pages/ContextMenuPage';",
          line: 16,
          path: "src/steps/contextMenu.steps.ts",
          source: "16: Then('I exercise the Context Menu page', async function () {",
        },
      ],
    });

    assert.match(explanation, /QA note: This scenario does a lot/);
    assert.match(explanation, /QA note: The word "exercise" hides the real behavior/);
    assert.match(explanation, /load\/content scenario and a right-click alert scenario/);
  });

  it("calls out unmatched step definitions as repair work", () => {
    const explanation = buildLocalScenarioExplanation({
      scenario: {
        keyword: "Scenario",
        line: 14,
        name: "Secure area rejects unauthenticated users",
        steps: [
          {
            keyword: "Given",
            line: 15,
            matchedDefinition: {
              expression: "I open the secure area without signing in",
              line: 11,
              path: "src/steps/formAuth.steps.ts",
            },
            text: "I open the secure area without signing in",
          },
          {
            keyword: "Then",
            line: 16,
            matchedDefinition: null,
            text: "access should be rejected with an authentication-required error",
          },
        ],
        tags: ["@regression"],
        unmatchedStepCount: 1,
      },
    });

    assert.match(explanation, /QA note: This scenario has 1 unmatched step definition/);
    assert.match(explanation, /Then access should be rejected with an authentication-required error/);
    assert.match(explanation, /Add or repair the missing step definition/);
  });
});
