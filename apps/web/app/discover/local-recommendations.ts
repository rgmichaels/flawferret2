import type { DiscoverTestRecommendation } from "@flawferret2/job-schemas";

export const toPageLabel = (pageUrl: string) => {
  try {
    const url = new URL(pageUrl);
    const pathLabel = url.pathname.replace(/^\/+|\/+$/g, "").replace(/[-_/]+/g, " ");

    return pathLabel.length > 0 ? pathLabel : url.hostname;
  } catch {
    return pageUrl || "page";
  }
};

const hasKeyword = (value: string, keywords: string[]) => {
  const normalized = value.toLowerCase();

  return keywords.some((keyword) => normalized.includes(keyword));
};

const hasSearchBarIntent = (value: string) =>
  /\b(search\s*(bar|box|field|input)|query\s*(bar|box|field|input)|site\s*search)\b/i.test(value);

export const buildRecommendations = ({
  notes,
  pageUrl,
}: {
  notes: string;
  pageUrl: string;
}): DiscoverTestRecommendation[] => {
  if (!pageUrl) {
    return [];
  }

  const pageLabel = toPageLabel(pageUrl);
  const context = `${pageUrl} ${notes}`;
  const searchBarIntent = hasSearchBarIntent(notes);
  const authPage = hasKeyword(context, ["auth", "login", "sign in", "password", "secure"]);
  const formPage = authPage || hasKeyword(context, ["form", "checkout", "search", "input", "submit"]);
  const listPage = hasKeyword(context, ["table", "list", "search", "filter", "results"]);
  const destructivePage = hasKeyword(context, ["delete", "remove", "admin", "settings"]);
  const recommendations: DiscoverTestRecommendation[] = [
    {
      acceptance: [
        "Navigate to the target page.",
        "Assert the primary heading or landmark loads.",
        "Verify the page has at least one stable, user-visible signal before interaction.",
      ],
      impact: "High",
      reason: "A focused load smoke test catches routing, rendering, and broken deployment issues quickly.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        `Then the ${pageLabel} page should load`,
      ],
      tags: ["@smoke", "@page-load"],
      title: `${pageLabel} page loads with stable content`,
    },
    {
      acceptance: [
        "Verify the document title exists and is not empty.",
        "Prefer an assertion that can fail with a clear message.",
      ],
      impact: "Medium",
      reason: "Missing title metadata is easy to regress and affects navigation, accessibility, and browser context.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "Then the page title should be populated",
      ],
      tags: ["@metadata"],
      title: `${pageLabel} page exposes a populated title`,
    },
    {
      acceptance: [
        "Navigate to the page.",
        "Check footer or global navigation content that should be present across the app.",
      ],
      impact: "Medium",
      reason: "Global shell checks catch broken layout composition without overloading page-specific scenarios.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "Then the global navigation or footer should be valid",
      ],
      tags: ["@layout"],
      title: `${pageLabel} page keeps global shell content intact`,
    },
  ];

  if (searchBarIntent) {
    recommendations.splice(
      1,
      0,
      {
        acceptance: [
          "Locate the primary search input by role, label, placeholder, or another user-facing selector.",
          "Enter a realistic query and submit it using the visible search affordance.",
          "Assert the submitted query is reflected in the resulting page, URL, heading, or search results.",
        ],
        impact: "High",
        reason: "Tester notes explicitly called out the search bar, so the most valuable coverage is the primary query submission path.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I search for a known query from the search bar",
          "Then the search results should reflect that query",
        ],
        tags: ["@search", "@search-bar", "@smoke"],
        title: `${pageLabel} search bar submits a query and shows results`,
      },
      {
        acceptance: [
          "Focus the primary search input using keyboard navigation or a stable locator.",
          "Type a query and submit it with Enter.",
          "Assert the same search behavior occurs as the visible search button path.",
        ],
        impact: "High",
        reason: "Keyboard search submission is a high-use path and catches accessibility or event-handler regressions.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I submit a search query with the Enter key",
          "Then the search results should reflect that query",
        ],
        tags: ["@search", "@keyboard"],
        title: `${pageLabel} search bar supports keyboard submission`,
      },
      {
        acceptance: [
          "Focus the search input and leave the query empty.",
          "Attempt to submit the search.",
          "Assert the page prevents an unclear navigation or shows helpful validation.",
        ],
        impact: "Medium",
        reason: "Empty search behavior is a small edge case that often creates confusing redirects or blank result pages.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I submit an empty search query",
          "Then the page should handle the empty search clearly",
        ],
        tags: ["@search", "@empty-state"],
        title: `${pageLabel} search bar handles empty queries clearly`,
      },
      {
        acceptance: [
          "Type a partial query into the primary search input.",
          "If suggestions appear, assert they are visible, keyboard reachable, and relevant to the typed query.",
          "If suggestions are intentionally absent, assert the input remains usable and stable.",
        ],
        impact: "Medium",
        reason: "Search suggestions are interactive and regression-prone when front-end search experiences change.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I type a partial query into the search bar",
          "Then search suggestions should remain usable or intentionally absent",
        ],
        tags: ["@search", "@suggestions"],
        title: `${pageLabel} search bar suggestions stay usable`,
      },
    );
  }

  if (formPage && !searchBarIntent) {
    recommendations.push(
      {
        acceptance: [
          "Submit the form with required fields empty.",
          "Assert user-visible validation feedback appears.",
          "Keep the scenario focused on validation, not successful submission.",
        ],
        impact: "High",
        reason: "Required-field validation is high-impact and often regresses when forms are refactored.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I submit the form without required values",
          "Then I should see validation feedback",
        ],
        tags: ["@form", "@validation"],
        title: `${pageLabel} form rejects missing required values`,
      },
      {
        acceptance: [
          "Enter invalid data into the most important field.",
          "Submit the form.",
          "Assert the error message is clear and remains visible.",
        ],
        impact: "High",
        reason: "Invalid-input coverage protects the most common negative path.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I submit invalid form data",
          "Then I should see a clear error message",
        ],
        tags: ["@form", "@negative"],
        title: `${pageLabel} form shows a clear invalid-input error`,
      },
      {
        acceptance: [
          "Enter data into user-editable fields.",
          "Trigger validation failure.",
          "Assert useful user-entered values remain available when appropriate.",
        ],
        impact: "Medium",
        reason: "Preserving useful input after validation failure reduces user friction and catches accidental resets.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When validation fails after I enter form data",
          "Then recoverable form values should remain populated",
        ],
        tags: ["@form", "@usability"],
        title: `${pageLabel} form preserves recoverable values after errors`,
      },
    );
  }

  if (authPage) {
    recommendations.push(
      {
        acceptance: [
          "Attempt authentication with invalid credentials.",
          "Assert the request is rejected.",
          "Assert a user-visible error is shown.",
        ],
        impact: "High",
        reason: "Authentication failure coverage protects a critical user and security path.",
        scenario: [
          "Given I am on the login page",
          "When I submit invalid credentials",
          "Then I should see an authentication error",
        ],
        tags: ["@auth", "@negative"],
        title: "Invalid login is rejected with a clear error",
      },
      {
        acceptance: [
          "Navigate directly to a secure URL without a signed-in session.",
          "Assert the app denies access or redirects appropriately.",
          "Assert the user receives a clear authentication-required signal.",
        ],
        impact: "High",
        reason: "Direct URL access is a critical bypass path for authenticated areas.",
        scenario: [
          "Given I am not signed in",
          "When I open a secure page directly",
          "Then access should require authentication",
        ],
        tags: ["@auth", "@security"],
        title: "Secure content blocks unauthenticated direct access",
      },
    );
  }

  if (listPage && !searchBarIntent) {
    recommendations.push(
      {
        acceptance: [
          "Use search or filtering controls with a known term.",
          "Assert matching results remain visible.",
          "Assert non-matching or empty results are handled clearly.",
        ],
        impact: "High",
        reason: "Search and filter behavior is a high-value workflow on list-heavy pages.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I filter the visible results",
          "Then matching results should remain visible",
        ],
        tags: ["@search", "@filter"],
        title: `${pageLabel} filtering narrows results predictably`,
      },
      {
        acceptance: [
          "Open the page with no available results or use a query that returns none.",
          "Assert a helpful empty state appears.",
        ],
        impact: "Medium",
        reason: "Empty states are frequent edge cases and easy to overlook.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When no matching results are available",
          "Then I should see a helpful empty state",
        ],
        tags: ["@empty-state"],
        title: `${pageLabel} empty state explains when no results match`,
      },
    );
  }

  if (destructivePage) {
    recommendations.push({
      acceptance: [
        "Trigger the destructive action.",
        "Assert a confirmation or guard appears before the action completes.",
        "Assert canceling the guard leaves data unchanged.",
      ],
      impact: "High",
      reason: "Destructive operations need guardrails and clear cancellation behavior.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "When I start a destructive action",
        "Then I should be asked to confirm before changes are made",
      ],
      tags: ["@safety", "@destructive"],
      title: `${pageLabel} destructive actions require confirmation`,
    });
  }

  recommendations.push(
    {
      acceptance: [
        "Navigate using keyboard to primary interactive controls.",
        "Assert controls are reachable and have accessible names.",
      ],
      impact: "High",
      reason: "Accessible interaction checks catch severe usability regressions that visual-only checks miss.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "When I navigate primary controls with the keyboard",
        "Then the controls should be reachable and named",
      ],
      tags: ["@accessibility", "@keyboard"],
      title: `${pageLabel} primary controls are keyboard reachable`,
    },
    {
      acceptance: [
        "Load the page at a mobile-sized viewport.",
        "Assert primary content and actions remain visible and usable.",
      ],
      impact: "Medium",
      reason: "Responsive smoke coverage catches layout regressions before they become manual QA surprises.",
      scenario: [
        `Given I view the ${pageLabel} page on a mobile viewport`,
        "Then primary content and actions should remain usable",
      ],
      tags: ["@responsive"],
      title: `${pageLabel} page remains usable on mobile viewport`,
    },
    {
      acceptance: [
        "Exercise the main action once.",
        "Assert no unexpected console errors appear during the flow.",
      ],
      impact: "Medium",
      reason: "Console-error checks catch hidden client-side failures that may not visibly break the page.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "When I exercise the primary page action",
        "Then no unexpected console errors should be recorded",
      ],
      tags: ["@client-health"],
      title: `${pageLabel} primary flow avoids unexpected console errors`,
    },
  );

  return recommendations.slice(0, 20);
};
