const { Toolkit } = require("actions-toolkit");

const Heroku = require("heroku-client");
const heroku = new Heroku({ token: process.env.HEROKU_API_TOKEN });

// Run your GitHub Action!
Toolkit.run(
  async (tools) => {
    const pr = tools.context.payload.pull_request;

    // Required information
    const event = tools.context.event;
    const branch = pr.head.ref;
    const version = pr.head.sha;
    const fork = pr.head.repo.fork;
    const pr_number = pr.number;
    const repo_url = pr.head.repo.html_url;
    const repo_name = pr.head.repo.name;
    const owner = pr.head.repo.owner.login;
    // Note!! Make sure you use a personal access token and not the implicit
    //        secrets.GITHUB_TOKEN
    const github_pa_token = process.env.GITHUB_PA_TOKEN;

    // This worked:
    const source_url = `https://${owner}:${github_pa_token}@api.github.com/repos/${owner}/${repo_name}/tarball/${branch}`;

    let fork_repo_id;
    if (fork) {
      fork_repo_id = pr.head.repo.id;
    }

    tools.log.debug("Deploy Info", {
      branch,
      version,
      fork,
      pr_number,
      source_url,
      repo_name,
      owner
    });

    let action = tools.context.payload.action;

    // Output value indicating if this was a new or existing deployment.
    let status = 'new';

    // We can delete a review app without them being a collaborator
    // as the only people that can close PRs are maintainers or the author
    // HIPOCAMPO TODO: Need to put the clean-up logic back in, here or another
    //                 action.
    // if (action === "closed") {

    // Fetch all PRs
    tools.log.pending("Listing review apps");
    const reviewApps = await heroku.get(
      `/pipelines/${process.env.HEROKU_PIPELINE_ID}/review-apps`
    );
    tools.log.complete("Fetched review app list");

    // Filter to the one for this PR
    const app = reviewApps.find((app) => app.pr_number == pr_number);
    if (!app) {
      tools.log.info(`Did not find review app for PR number ${pr_number}`);
      // return;
    } else {
      tools.log.pending("Deleting existing review app");
      await heroku.delete(`/review-apps/${app.id}`);
      tools.log.complete("Review app deleted");
    }

    //   return;
    // }

    // Do they have the required permissions?
    let requiredCollaboratorPermission = process.env.COLLABORATOR_PERMISSION;
    if (requiredCollaboratorPermission) {
      requiredCollaboratorPermission = requiredCollaboratorPermission.split(
        ","
      );
    } else {
      requiredCollaboratorPermission = ["triage", "write", "maintain", "admin"];
    }

    const reviewAppLabelName =
      process.env.REVIEW_APP_LABEL_NAME || "review-app";

    const perms = await tools.github.repos.getCollaboratorPermissionLevel({
      ...tools.context.repo,
      username: tools.context.actor,
    });

    if (!requiredCollaboratorPermission.includes(perms.data.permission)) {
      tools.exit.success("User is not a collaborator. Skipping");
    }

    tools.log.info(`User is a collaborator: ${perms.data.permission}`);

    let createReviewApp = false;

    if (["opened", "reopened", "synchronize"].indexOf(action) !== -1) {
      tools.log.info("PR opened by collaborator");
      createReviewApp = true;
      await tools.github.issues.addLabels({
        ...tools.context.repo,
        labels: ["review-app"],
        issue_number: pr_number,
      });
    } else if (action === "labeled") {
      const labelName = tools.context.payload.label.name;
      tools.log.info(`${labelName} label was added by collaborator`);

      if (labelName === reviewAppLabelName) {
        createReviewApp = true;
      } else {
        tools.log.debug(`Unexpected label, not creating app: ${labelName}`);
      }
    }

    if (createReviewApp) {
      // If it's a fork, creating the review app will fail as there are no secrets available
      if (fork && event == "pull_request") {
        tools.log.pending("Fork detected. Exiting");
        tools.log.pending(
          "If you would like to support PRs from forks, use the pull_request_target event"
        );
        tools.log.success("Action complete");
        return;
      }

      try {
        const resp = await heroku.request({
          path: `/review-apps${id}`,
          method: "DELETE"
        });
      } catch (error) {

      }

      // Otherwise we can complete it in this run
      try {
        tools.log.pending("Creating review app");
        const resp = await heroku.request({
          path: "/review-apps",
          method: "POST",
          body: {
            branch,
            pipeline: process.env.HEROKU_PIPELINE_ID,
            source_blob: {
              url: source_url,
              version,
            },
            fork_repo_id,
            pr_number,
            environment: {
              GIT_REPO_URL: repo_url,
            }
          }
        });
        tools.log.complete("Created review app");
      } catch (e) {
        // HIPOCAMPO UPDATE: We are now deleting the existing review apps
        //                   every time so we should never get here.
        // A 409 is a conflict, which means the app already exists
        if (e.statusCode !== 409) {
          throw e;
        }
        status = 'existing';
        tools.log.complete("Review app is already created");
      }
    }

    // print(f"::set-output name=review_app_name::{review_app_name}")
    tools.outputs.status = status;
    tools.log.success("Action complete");
  },
  {
    event: [
      "pull_request.opened",
      "pull_request.reopened",
      "pull_request.synchronize",
      "pull_request.labeled",
      "pull_request.closed",
      "pull_request_target.opened",
      "pull_request_target.reopened",
      "pull_request_target.synchronize",
      "pull_request_target.labeled",
      "pull_request_target.closed"
    ],
    secrets: ["GITHUB_TOKEN", "GITHUB_PA_TOKEN", "HEROKU_API_TOKEN", "HEROKU_PIPELINE_ID"],
  }
);
