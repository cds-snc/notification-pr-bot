jest.mock("./github", () => ({
  AWS_ECR_URL: "public.ecr.aws/cds-snc",
  TARGET_REPO: "notification-manifests",
  getContents: jest.fn(),
  getHeadSha: jest.fn(),
  createPR: jest.fn(),
  closePRs: jest.fn(),
}));

const { Base64 } = require("js-base64");
const { getContents, getHeadSha, createPR } = require("./github");
const { getReleaseImageChange, main } = require("./index");
const { getRepoDefaults } = require("./repo-defaults");
const sha = `abcdef0${"1".repeat(33)}`;
const project = {
  repoName: "notification-api",
  helmfileTagKey: "API_DOCKER_TAG",
  helmfileOverride: "helmfile/overrides/production.env",
  ecrName: "notify-api",
  ecrUrl: "public.ecr.aws/cds-snc",
  headSha: sha,
};

beforeEach(() => jest.resetAllMocks());

test("records full selected revisions for every default production image", async () => {
  getContents.mockRejectedValue({ status: 404 });
  const projects = getRepoDefaults("notification-manifests", "public.ecr.aws/cds-snc").projects
    .map((entry) => ({ ...entry, headSha: sha }));
  const change = await getReleaseImageChange(projects);
  const record = JSON.parse(Base64.decode(change.newReleaseContentBlob));
  expect(record.version).toBe(1);
  expect(Object.keys(record.images)).toHaveLength(13);
  expect(record.images.API_DOCKER_TAG).toEqual({
    source: "cds-snc/notification-api", sha, tag: "abcdef0",
  });
  expect(change.fileHasChanged).toBe(true);
  expect(change.releaseContent).toBeUndefined();
});

test("does not rewrite an unchanged revision record", async () => {
  getContents.mockRejectedValueOnce({ status: 404 });
  const first = await getReleaseImageChange([project]);
  getContents.mockResolvedValue({ content: first.newReleaseContentBlob });
  expect((await getReleaseImageChange([project])).fileHasChanged).toBe(false);
});

test("propagates read failures rather than overwriting the record", async () => {
  getContents.mockRejectedValue(new Error("GitHub unavailable"));
  await expect(getReleaseImageChange([project])).rejects.toThrow("GitHub unavailable");
});

test("rejects incomplete revisions and duplicate config keys", async () => {
  await expect(getReleaseImageChange([{ ...project, headSha: "abcdef0" }]))
    .rejects.toThrow("full SHA");
  await expect(getReleaseImageChange([project, project])).rejects.toThrow("Duplicate");
});

test("pins one HEAD lookup per source and includes the record with config changes", async () => {
  getHeadSha.mockResolvedValue(sha);
  getContents.mockImplementation(async (repo, path) => {
    if (path === "release-images.json") throw { status: 404 };
    const contents = path === "VERSION" ? "v1.0.0" :
      'API_DOCKER_TAG: "1111111"\nWORKER_DOCKER_TAG: "1111111"\n';
    return { sha: "file-sha", content: Base64.encode(contents) };
  });
  await main(false, "Release", [
    { ...project }, { ...project, helmfileTagKey: "WORKER_DOCKER_TAG" },
  ], []);
  expect(getHeadSha).toHaveBeenCalledTimes(1);
  const args = createPR.mock.calls[0];
  expect(args[4][0].fileHasChanged).toBe(true);
  const record = JSON.parse(Base64.decode(args[6][0].newReleaseContentBlob));
  expect(record.images.API_DOCKER_TAG.sha).toBe(sha);
  expect(record.images.WORKER_DOCKER_TAG.sha).toBe(sha);
});