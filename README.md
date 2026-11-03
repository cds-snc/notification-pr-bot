# PR-bot

Automatically creates production deployment PRs against a configurable target
repository.  Out of the box it is set up for
[notification-manifests](https://github.com/cds-snc/notification-manifests),
and it includes built-in defaults for
[notification-terraform](https://github.com/cds-snc/notification-terraform).

Set `target_repo` and the bot applies the matching defaults for title prefix,
template path, and image update config.

When targeting `notification-manifests`, generated release summaries include
both tracked component repos and direct `notification-manifests` commits since
the currently deployed `VERSION` ref (tag or commit SHA).

This repository provides the bot/action logic. Triggering when to run the bot
is configured in the consuming repository workflows.

## Production image revision record

For `notification-manifests`, each release PR also includes `release-images.json`
alongside the production tag changes. Version 1 records the source repository,
full selected commit SHA, and seven-character image tag for every configured
release image. Each source repository HEAD is fetched once per bot run so images
from the same repository select the same revision.

The production image gate compares this record with the production configuration
and checks public and private ECR before allowing deployment. It does not compare
with a moving branch HEAD at deployment time. For a rollback or a manually selected
revision, restore or update both the configuration tag and its revision record.
Custom `PROJECTS`/`PROJECTS_LAMBDAS` entries targeting manifests must include the
corresponding `helmfileTagKey`.

Roll out this bot change before enabling the manifests gate, then regenerate the
production release PR to populate the record. A missing record intentionally
blocks release validation. The Terraform target does not generate this file.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TOKEN` | *(required)* | GitHub token with `repo` and `workflow` scopes |
| `TARGET_REPO` | `notification-manifests` | Target repo. Currently tuned for `notification-manifests` and `notification-terraform` |
| `TITLE_PREFIX` | target-specific | Optional override for PR title prefix |
| `PR_TEMPLATE_PATH` | target-specific | Optional override for PR template path |
| `PROJECTS` | target-specific | Optional JSON override for project image updates |
| `PROJECTS_LAMBDAS` | target-specific | Optional JSON override for Lambda image updates |

Advanced use: set `PROJECTS` / `PROJECTS_LAMBDAS` JSON only if you need to
override the built-in repo defaults.

## Development

Edit the [index.js](index.js) file as needed and then run the build command to
produce a single artifact in the `dist` folder.

Target-specific defaults for `notification-manifests` and
`notification-terraform` are defined in [repo-defaults.js](repo-defaults.js).

```shell
npm run build
```

## Local environment

[Create a GitHub API token](https://github.com/settings/tokens) with `repo`
and `workflow` scopes, then pass it along with any overrides you need:

```shell
TOKEN="${YOUR_TOKEN}" \
TARGET_REPO="notification-manifests" \
node index.js
```

Or export the variables for repeated runs:

```shell
export TOKEN="${YOUR_TOKEN}"
export TARGET_REPO="notification-terraform"
node index.js
```

Note: in production the auth token is fetched via
https://github.com/organizations/cds-snc/settings/installations/17812835
(CDS GitHub admin access required).
 