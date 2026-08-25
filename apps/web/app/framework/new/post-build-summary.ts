// Copy for the sticky build bar's "Then" cell — the post-build actions currently selected in the
// "After building" section. Kept dependency-free (no DOM/React) so it's directly unit-testable, and
// shared by the server render (initial value) and the live client refresh (form state), mirroring
// how build-client-preview-request.ts is used.
export const formatPostBuildActions = ({
  createGithubRepository,
  initializeGitRepository,
  registerLocalRepository,
}: {
  createGithubRepository: boolean;
  initializeGitRepository: boolean;
  registerLocalRepository: boolean;
}): string => {
  const actions: string[] = [];

  if (initializeGitRepository) {
    actions.push("git init");
  }

  if (createGithubRepository) {
    actions.push("push to GitHub");
  }

  if (registerLocalRepository) {
    actions.push("register");
  }

  return actions.length > 0 ? actions.join(" · ") : "Nothing";
};

// Mirrors getCheckedFormValue in page.tsx: each toggle renders a hidden "false" input followed by a
// "true" checkbox, so the last submitted value is the live one.
const isChecked = (formData: FormData, name: string) => {
  const lastValue = formData.getAll(name).map(String).at(-1);

  return lastValue === "true" || lastValue === "on";
};

export const describePostBuildActions = (formData: FormData): string =>
  formatPostBuildActions({
    createGithubRepository: isChecked(formData, "createGithubRepository"),
    initializeGitRepository: isChecked(formData, "initializeGitRepository"),
    registerLocalRepository: isChecked(formData, "registerLocalRepository"),
  });
