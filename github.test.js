// Mock Octokit modules before any require() calls so that github.js
// gets the mock when it is first loaded.
const mockListCommits = jest.fn();

jest.mock("@octokit/core", () => {
  function MockOctokit() {
    this.rest = { repos: { listCommits: mockListCommits } };
  }
  MockOctokit.plugin = function () {
    return MockOctokit;
  };
  return { Octokit: MockOctokit };
});

jest.mock("@octokit/plugin-rest-endpoint-methods", () => ({
  restEndpointMethods: jest.fn(),
}));

// js-base64 is used for PR content encoding; a passthrough mock is sufficient
// here since tests only inspect the `buildLogs` return value, not encoded blobs.
jest.mock("js-base64", () => ({ Base64: { encode: (s) => s } }));

// Set a dummy token so the module loads without crashing.
process.env.TOKEN = "test-token";

const { buildLogs } = require("./github");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake GitHub commit object as returned by the Octokit REST API.
 */
function makeApiCommit(sha, message, authorName = "Test Author") {
  return {
    sha,
    commit: { message, author: { name: authorName } },
    html_url: `https://github.com/cds-snc/test-repo/commit/${sha}`,
  };
}

/**
 * Simulate getCommitMessages behaviour: commits *before* the matching sha are
 * "new".  Pass an empty array to simulate a repo with no new commits.
 */
function setupListCommits(apiCommits) {
  mockListCommits.mockResolvedValueOnce({ data: apiCommits });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockListCommits.mockReset();
});

describe("buildLogs – empty repository headers", () => {
  test("omits header for a repo with no new commits when another repo has commits", async () => {
    // notification-admin: oldSha is the first (only) commit → slice(0,0) = no new commits
    setupListCommits([makeApiCommit("oldsha_admin", "Baseline", "Someone")]);

    // notification-api: one new commit before oldSha
    setupListCommits([
      makeApiCommit("abc123", "Added bounce rate suspension (#2951)", "Jumana B"),
      makeApiCommit("oldsha_api", "Old commit", "Someone"),
    ]);

    const projects = [
      { repoName: "notification-admin", oldSha: "oldsha_admin" },
      { repoName: "notification-api", oldSha: "oldsha_api" },
    ];

    const result = await buildLogs(projects);

    // The copy-ready section should NOT contain the empty repo header.
    expect(result).not.toMatch(/NOTIFICATION-ADMIN\n\n\n/);
    expect(result).not.toMatch(/^NOTIFICATION-ADMIN$/m);

    // The copy-ready section SHOULD contain the repo that has a commit.
    expect(result).toContain("NOTIFICATION-API");
    expect(result).toContain("#2951");
    expect(result).toContain("Jumana B");
  });

  test("renders no copy-ready section headers when all repos have no new commits", async () => {
    // Both repos: oldSha is the first commit → no new commits.
    setupListCommits([makeApiCommit("sha1", "Baseline admin", "Alice")]);
    setupListCommits([makeApiCommit("sha2", "Baseline download", "Bob")]);

    const projects = [
      { repoName: "notification-admin", oldSha: "sha1" },
      { repoName: "notification-document-download-api", oldSha: "sha2" },
    ];

    const result = await buildLogs(projects);

    // The <details> copy-ready wrapper should be absent — no section headers to show.
    expect(result).not.toContain("<details>");
    expect(result).not.toContain("<summary>Copy Rendered Summary</summary>");

    // Plain-text repo headers (as they appear in the copy-ready block) must not be present.
    // (Repo names may still appear in the markdown table as data rows, which is fine.)
    const copyReadyHeaderPattern = /^NOTIFICATION-ADMIN$/m;
    expect(result).not.toMatch(copyReadyHeaderPattern);

    // The markdown table header should still be present (table always rendered).
    expect(result).toContain("| Component | Changes |");
  });

  test("renders repo headers for repos that do have commits", async () => {
    setupListCommits([
      makeApiCommit("sha_new", "New feature (#99)", "Alice"),
      makeApiCommit("sha_old", "Baseline commit", "Bob"),
    ]);

    const projects = [{ repoName: "notification-api", oldSha: "sha_old" }];

    const result = await buildLogs(projects);

    expect(result).toContain("NOTIFICATION-API");
    expect(result).toContain("<details>");
    expect(result).toContain("#99");
  });

  test("repos with entries are sorted alphabetically", async () => {
    // notification-utils has a commit, notification-api has a commit.
    setupListCommits([
      makeApiCommit("sha2_new", "Utils fix (#7)", "Carol"),
      makeApiCommit("sha2_old", "Old utils", "Carol"),
    ]);
    setupListCommits([
      makeApiCommit("sha1_new", "API feat (#3)", "Dave"),
      makeApiCommit("sha1_old", "Old api", "Dave"),
    ]);

    const projects = [
      { repoName: "notification-utils", oldSha: "sha2_old" },
      { repoName: "notification-api", oldSha: "sha1_old" },
    ];

    const result = await buildLogs(projects);

    const apiIdx = result.indexOf("NOTIFICATION-API");
    const utilsIdx = result.indexOf("NOTIFICATION-UTILS");

    expect(apiIdx).toBeGreaterThanOrEqual(0);
    expect(utilsIdx).toBeGreaterThanOrEqual(0);
    // API should appear before UTILS in alphabetical order.
    expect(apiIdx).toBeLessThan(utilsIdx);
  });
});
