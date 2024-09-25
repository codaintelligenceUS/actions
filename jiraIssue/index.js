import { getInput, setFailed } from "@actions/core";
import JiraApi from "jira-client";
import { Octokit } from "octokit";
import j2m from "jira2md";

/** Extra usernames that can block PRs. Only affects the `checkForTesterApproval` step */
const TESTER_BACKUPS = "bogdan-calapod,octavian.grigorescu";
/** Label to be applied for checking tester backups as well as QA members */
const TESTER_APPROVAL_LABEL_SKIP = "qa-test-bypass";

const jiraTicketRegex = /\bFN-\d+\b/g;
const accountIdRegex = /\[~accountid:(.*?)\]/g;

const jiraFields = {
  DESIGN_LINK: "customfield_10558",
  PRODUCT_AREA: "customfield_10571",
  CLIENTS: "customfield_10566",
  PR_LINK: "customfield_10574",
  TEST_REJECTION_REASON: "customfield_10607",
};

const statuses = {
  backlog: "⚪ Backlog",
  inProgress: "🔵 In Progress",
  inReview: "🔵 In Review",
  inQa: "🟠 In QA",
  qaRejected: "🔴 QA Rejected",
  dev: "🟠 Dev",
  staging: "🟠 Staging",
  production: "🟢 Production",
};

const config = {
  api: {
    protocol: "https",
    host: getInput("jira_host").replaceAll("https://", "").replaceAll("/", ""),
    email: getInput("jira_email"),
    token: getInput("jira_token"),
  },
  ticketKeys: [
    ...new Set(getInput("ticket_keys").match(jiraTicketRegex) || []),
  ],
  actionToTake: getInput("action_to_take"),
  prNumber: getInput("pr_number"),
  releaseVersion: getInput("release_version"),
  repoName: getInput("repo_name"),
  ghToken: getInput("gh_token"),
  testerUsernames: getInput("tester_usernames").split(","),
};

const actionsToTake = {
  checkForTesterApproval,
  markAsInProgressOrInReview,
  markAsInTesting,
  markAsTestingRejected,
  markAsDeployedToDev,
  markAsDeployedToStaging,
  markAsDeployedToProduction,
};

async function main() {
  try {
    console.log("📋 Validating requested action is valid");
    console.log("🔧 Configuration:", JSON.stringify(config, null, 4));
    const validActions = Object.keys(actionsToTake);

    console.log("🔌 Connecting to Jira...");
    const jira = new JiraApi({
      protocol: config.api.protocol,
      host: config.api.host,
      username: config.api.email,
      password: config.api.token,
    });

    await getPrInfo(jira);

    if (!validActions.includes(config.actionToTake)) {
      console.error(
        `‼️  Requested action ${config.actionToTake} is not valid. Valid actions are: \n * ${validActions.join("\n * ")}`,
      );
      process.exit(-1);
    }

    const actionFunction = actionsToTake[config.actionToTake];

    await actionFunction(jira);
  } catch (error) {
    console.error(error);
    setFailed(error.message);
  }
}

/**
 * Marks the passed issues as in progress
 *
 * @param {JiraApi} jira API Client for jira
 */
async function markAsInProgressOrInReview(jira) {
  if (config.prNumber === "") {
    // Just mark the issue as in progress, remove testers and bail
    await markAsState(jira, config.ticketKeys, statuses.inProgress);

    for (const tester of config.testerUsernames) {
      if (reviewers.includes(tester)) {
        console.log(
          `🔍 Found tester user ${tester} in pending reviewers list - removing...`,
        );
        await removePrReviewRequest(tester);
      }
    }

    return;
  }

  if (config.prNumber !== "") {
    console.warn("PR Number found, checking if it is draft");
    const pr = await getPrInfo(jira);

    if (pr.data.closed_at !== null && !pr.data.merged) {
      console.warn("‼️  PR is marked as closed, moving it to backlog");
      await markAsState(jira, config.ticketKeys, statuses.backlog);
      return;
    }

    if (pr.data.closed_at !== null && pr.data.merged) {
      console.log("🟠 Marking as merged to dev");
      await markAsState(jira, config.ticketKeys, statuses.dev);
      return;
    }

    if (!pr.data.draft) {
      console.warn("PR is marked as open - transitioning issue to In Review");
      await markAsState(jira, config.ticketKeys, statuses.inReview);
    } else {
      await markAsState(jira, config.ticketKeys, statuses.inProgress);
    }

    if (!config.testerUsernames) {
      console.log("🤷 No tester usernames passed, bailing");
    }
    // Remove testers, if passed
    console.log(
      "🤔 Ensuring no reviewers are added, to ensure no testing state (e.g. this was a push, not a reviewer add action)",
    );

    const reviewers = (await getPrReviewRequestsUsers()).map((u) => u.login);

    for (const tester of config.testerUsernames) {
      if (reviewers.includes(tester)) {
        console.log(
          `🔍 Found tester user ${tester} in pending reviewers list - removing...`,
        );
        await removePrReviewRequest(tester);
      }
    }
  }
}

/**
 * Marks the passed issue as in testing, if the specified reviewer is passed. If not, it bails
 *
 * This should be called on the `reviewer_added` event
 *
 * @param {JiraApi} jira - Jira API Client
 */
async function markAsInTesting(jira) {
  if (config.prNumber === "") {
    console.error(
      "‼️  No PR number specified - not changing status to in testing",
    );
    process.exit(-1);
  }

  const pr = await getPrInfo(jira);

  if (pr.data.draft) {
    console.error(
      "⚠️  Specified PR is marked as Draft. Exiting without editing.",
    );
    process.exit(0);
  }

  const requestedReviewers = (await getPrReviewRequestsUsers()).filter((user) =>
    config.testerUsernames.includes(user.login),
  );

  if (requestedReviewers.length === 0) {
    console.warn(
      "⚠️  No testers found in assigned reviewers, converting to in progress",
    );
    await markAsInProgressOrInReview(jira);
    process.exit(0);
  }

  await markAsState(jira, config.ticketKeys, statuses.inQa);
}

/**
 * Marks the passed issue as testing rejected, if the reviewer is passed and review is requesting changes.
 *
 * This should be called on the review_submitted event
 *
 * @param {JiraApi} jira - Jira API Client
 */
async function markAsTestingRejected(jira) {
  if (config.prNumber === "") {
    console.error(
      "‼️  No PR number specified - not checking if we shouldc convert to testing rejected",
    );
    process.exit(-1);
  }

  const pr = await getPrInfo(jira);

  if (pr.data.draft) {
    console.error(
      "⚠️  Specified PR is marked as Draft. Exiting without editing.",
    );
    process.exit(0);
  }

  console.log("🤔 Checking if review was re-requested from QA...");
  const requestedReviewers = (await getPrReviewRequestsUsers()).filter((user) =>
    config.testerUsernames.includes(user.login),
  );

  if (requestedReviewers.length > 0) {
    console.log("📝 PR is waiting on a re-request, bailing");
    return;
  }

  const reviews = await getPrReviews();
  /**
   * The tester reviewers may have multiple ones left - we only need the last one
   * to be an approval
   *
   * @type Optional<typeof reviews[0]>
   */
  const latestReview = reviews.toReversed().at(0);
  const isLatestReviewFromQA = config.testerUsernames.includes(
    latestReview.user.login,
  );

  console.log(JSON.stringify(reviews.toReversed(), null, 4));

  if (!isLatestReviewFromQA) {
    console.log("🔍 Latest review not from QA, marking as in review...");
    await markAsInProgressOrInReview(jira);
    return;
  }

  if (!latestReview || latestReview.state === "APPROVED") {
    console.log("✅ No rejected reviews - exiting");
    process.exit(0);
  }

  console.log(
    "😵 Rejected review found - saving review comment and transitioning issue to Testing Rejected",
  );
  transitionIssue(jira, config.ticketKeys[0], statuses.qaRejected);
  const rejectedReviewMessage = latestReview.body;
  await editIssueField(
    config.ticketKeys[0],
    jiraFields.TEST_REJECTION_REASON,
    rejectedReviewMessage,
  );
}

/**
 * Marks the passed issue as Dev, or Dev No QA if no QA approval was received.
 *
 * This should be called on commits in `main`.
 *
 * Since the commits on main aren't linked to their PRs anymore, we get the PR manually from the associated field we have on them.
 *
 * @param {JiraApi} jira - Jira API Client
 */
async function markAsDeployedToDev(jira) {
  console.log(`🔧 Marking issue as being deployed to dev...`);

  console.log(`📋 Retrieving PR number...`);

  for (const ticket of config.ticketKeys) {
    console.log(`🎫 Processing ticket ${ticket}`);
    await transitionIssue(jira, ticket, statuses.dev);
  }
}

/**
 * Marks the passed issue as Staging, assigning its release field as well
 *
 * This should be called on release, with the changelog list passed as param for ticket keys
 *
 * @param {JiraApi} jira - Jira API Client
 */
async function markAsDeployedToStaging(jira) {
  console.log(`🔧 Marking issue as being deployed to staging...`);

  const releaseId = await ensureReleaseExists(jira, config.releaseVersion);

  for (const ticket of config.ticketKeys) {
    console.log(`🎫 Processing ticket ${ticket}`);
    console.log(
      `    🚀 Setting release version to ${config.releaseVersion}...`,
    );
    await editIssueField(ticket, "fixVersions", [{ id: releaseId }]);
    await transitionIssue(jira, ticket, statuses.staging);
  }
}

/**
 * Marks the passed issue as Promoted
 *
 * This should be called on promote, with the changelog list passed as param for ticket keys
 *
 * @param {JiraApi} jira - Jira API Client
 */
async function markAsDeployedToProduction(jira) {
  console.log(`🔧 Marking issue as being deployed to promote...`);

  const releaseId = await ensureReleaseExists(
    jira,
    config.releaseVersion,
    true,
  );

  for (const ticket of config.ticketKeys) {
    console.log(`🎫 Processing ticket ${ticket}`);
    console.log(
      `    🚀 Setting release version to ${config.releaseVersion}...`,
    );
    await editIssueField(ticket, "fixVersions", [{ id: releaseId }]);
    await transitionIssue(jira, ticket, statuses.production);
  }
}

/**
 * Check if the PR has passed at least one QA approval
 *
 * @param {JiraApi} jira - JIRA API Client
 */
async function checkForTesterApproval(jira) {
  console.log("📋 Checking for QA Approvals...");
  const labels = await getPrLabels();
  const hasSkipLabel = labels.includes(TESTER_APPROVAL_LABEL_SKIP);
  const hasDevopsLabel = labels.includes("devops");

  if (!hasSkipLabel) {
    console.warn(
      `⚠️  Label ${TESTER_APPROVAL_LABEL_SKIP} not found in PR labels, checking only reviews from QA members`,
    );
  }

  if (hasDevopsLabel) {
    console.warn(`⚠️  Devops label found - skipping tester check`);
    return;
  }

  const reviews = await getPrReviews();
  const testerUsernames = hasSkipLabel
    ? [...config.testerUsernames, ...TESTER_BACKUPS.split(",")]
    : config.testerUsernames;

  console.log(testerUsernames);
  const acceptedReviews = reviews.filter(
    (r) => testerUsernames.includes(r.user.login) && r.state === "APPROVED",
  );

  console.log(JSON.stringify(acceptedReviews, null, 4));

  if (acceptedReviews?.length === 0) {
    console.error("🚨 No approving reviews found");
    process.exit(-1);
  }

  console.log("✅ Accept found from QA");
}

main();

/* --------------------- Utility Functions ----------------------- */

/**
 * Helper function for getting the Octokit client
 */
async function getOctoClient() {
  return new Octokit({ auth: config.ghToken });
}

/**
 * Helper function for getting the currently passed PR info
 *
 * @param {JiraApi} jira - Jira API connector
 */
async function getPrInfo(jira) {
  const octo = await getOctoClient();

  if (
    ["markAsDeployedToStaging", "markAsDeployedToProduction"].includes(
      config.actionToTake,
    )
  ) {
    console.log("🤔 Deploy step requested - no PR info needed");

    const commits = await getLatestTagCommits();
    const ticketKeys = [...new Set(commits.match(jiraTicketRegex) || [])];

    config.ticketKeys = ticketKeys;
    return;
  }

  if (
    config.prNumber === "" &&
    config.ticketKeys.length === 0 &&
    config.releaseVersion === ""
  ) {
    console.log(
      "🚧 Cannot run without either PR Number or ticket keys, exiting.",
    );
    process.exit(0);
  }

  console.log("🎋 Getting PR info...");

  if (config.prNumber === "" && config.ticketKeys.length > 0) {
    console.log("? No PR number found - getting from jira link");

    const issue = await jira.getIssue(config.ticketKeys[0]);
    const prField = issue.fields[jiraFields.PR_LINK] ?? "";
    const hasNumber = prField.split("/").some((x) => !isNaN(parseInt(x)));

    if (prField === "" || !hasNumber) {
      console.log(`🤷 No PR field on issue ${config.ticketKeys[0]} - bailing`);
      return;
    }

    console.log(`✅ Found PR URL: ${prField} - extracting PR number`);
    config.prNumber = prField.split("/").at(-2);
  }

  console.log(`📋 Getting PR info for ${config.prNumber}...`);
  const response = await octo.rest.pulls.get({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    pull_number: config.prNumber,
  });

  // Check if we have a release PR branch
  if (response.data.head.ref.includes("release/")) {
    console.log("💡 Release branch detected - exiting...");
    process.exit(0);
  }

  // Because GitHub's environment variables are wonky, if we have a PR number
  // fallback on the branch name from the PR instead
  config.ticketKeys = response.data.head.ref.match(jiraTicketRegex);
  console.log("💡 Updated ticketKeys from PR:", config.ticketKeys);

  return response;
}

/**
 * Helper function to remove a certain reviewer from the PR
 *
 * This is used when we have to remove the tester from the PR, for example when pushing
 *
 * @param {string} username The username to remove
 */
async function removePrReviewRequest(username) {
  console.log(`  🧹 Removing user ${username} from review requests...`);
  const octo = await getOctoClient();

  await octo.rest.pulls.removeRequestedReviewers({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    pull_number: config.prNumber,
    reviewers: [username],
  });
}

/**
 * Helper function for getting labels on a certain PR
 */
async function getPrLabels() {
  if (config.prNumber === "") {
    return [];
  }
  console.log("🏷️ Getting PR labels...");
  const octo = await getOctoClient();
  const response = await octo.rest.pulls.get({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    pull_number: config.prNumber,
  });

  return response.data.labels.map((label) => label.name);
}

/**
 * Helper function for getting reviews on a certain PR
 *
 * This is used to further check the review status
 */
async function getPrReviews() {
  if (config.prNumber === "") {
    return [];
  }
  console.log("📋 Getting PR reviews...");
  const octo = await getOctoClient();
  let page = 1;
  let reviews = [];
  let response;

  do {
    console.log(`\tGetting page ${page} of reviews...`);
    response = await octo.rest.pulls.listReviews({
      owner: config.repoName.split("/")[0],
      repo: config.repoName.split("/")[1],
      pull_number: config.prNumber,
      page,
    });
    reviews = [...reviews, ...response.data];
    page++;
  } while (response.data.length > 0);

  return reviews;
}

/**
 * Helper function for getting commits since the latest tag
 *
 * This is used to validate release changelog
 */
async function getLatestTagCommits() {
  console.log("🏷️ Getting commits for latest tag...");
  const octo = await getOctoClient();

  const tags = await octo.rest.repos.listTags({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    per_page: 2,
  });

  let page = 1;
  let latestCommits = [];
  let response;
  const currentTag = "HEAD";
  const previousTag = tags.data[1].commit.sha;

  do {
    console.log(`\tGetting page ${page} of commits for tag ${currentTag}...`);

    response = await octo.rest.repos.compareCommits({
      owner: config.repoName.split("/")[0],
      repo: config.repoName.split("/")[1],
      head: currentTag,
      base: previousTag,
      page,
      per_page: 100,
    });

    const commitsMessages = response.data.commits.map((c) => {
      if (!c.commit) {
        return "";
      }
      return c.commit.message;
    });
    latestCommits = [...latestCommits, ...commitsMessages];
    page++;
  } while (response.data.commits.length > 0);

  return latestCommits.join("\n");
}
/**
 * Helper function for getting review requests on a certain PR
 *
 * Reviewers are automatically removed by Github from this list once they submit a review
 */
async function getPrReviewRequestsUsers() {
  console.log("📋 Getting PR review requests...");
  const octo = await getOctoClient();
  const response = await octo.rest.pulls.listRequestedReviewers({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    pull_number: config.prNumber,
  });
  return response.data?.users ?? [];
}

/**
 * Helper to edit the description of the current Promise.reject(
 *
 * @param {string} title The new PR title to set
 * @param {string} description The new PR description to edit
 * @param {number} prNumber The PR number to update
 */
async function editPrDescription(title, description, prNumber) {
  console.log("📝 Editing PR description...");

  if (prNumber === "") {
    console.log("No PR number to update, exiting...");
  }

  const octo = await getOctoClient();
  await octo.rest.pulls.update({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    pull_number: prNumber,
    title,
    body: description,
  });
}

/**
 * Helper function to get transition IDs. These are used to trigger a transition
 *
 * @param {JiraApi} jira - The Jira Client instance
 * @param {string} issueId - ID of the issue to get the state for
 * @param {string} stateName - The state in which you want to transition the issue
 * @returns {Promise<object>} The transition object
 */
async function getTransition(jira, issueId, stateName) {
  const transitions = (await jira.listTransitions(issueId)).transitions;
  return transitions.find((v) => v.name === stateName);
}

/**
 * Helper function to get account information from Jira
 *
 * @param {string} accountId - The account ID, of the shape `[~accountid:<guid>]`
 * @returns {object} The user account object from the Jira API
 */
async function getAccountInfo(accountId) {
  accountId = accountId.split("accountid:")[1].replace("]", "");
  return await fetch(
    `https://${config.api.host}/rest/api/2/user?accountId=${accountId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${config.api.email}:${config.api.token}`,
        ).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Force-Accept-Language": true,
        "Accept-Language": "en-US",
      },
    },
  ).then((r) => r.json());
}

/**
 * Helper function to parse comment parameters (e.g. account ids) to a cleaner format
 *
 * @param {object} comment The comment object from the Jira API response
 */
async function parseComment(comment) {
  const accountIds = comment.body.match(accountIdRegex);

  if (accountIds !== null) {
    for (const accountId of accountIds) {
      const accountInfo = await getAccountInfo(accountId);

      comment.body = comment.body.replaceAll(
        accountId,
        `<kbd> <img src="${accountInfo.avatarUrls["16x16"]}" width="12" height="12"/> ${accountInfo.displayName} </kbd>`,
      );
    }
  }

  return `
<tr>
<td> <img src="${comment.author.avatarUrls["16x16"]}" /> <b>${comment.author.displayName}</b> </td>
<td> ${j2m.to_markdown(comment.body)} </td>
`;
}

/**
 * Helper function to transition an issue to a certain state
 *
 * @param {JiraApi} jira - The Jira Client instance
 * @param {string} issueId - The issue ID to change
 * @param {keyof typeof statuses} stateName - The state to change to
 */
async function transitionIssue(jira, issueId, stateName) {
  const issue = await jira.getIssue(issueId);
  try {
    await updateIssueDescription(jira);
  } catch (e) {
    console.error(e);
    console.error("Error updating PR description - just updating jira");
  }
  if (issue.fields.status.name === stateName) {
    console.log("\tCurrent state same as requested one, bailing");
    return;
  }
  const transition = await getTransition(jira, issueId, stateName);
  console.log(`\tTransitioning issue ${issueId} to ${transition.name}`);

  await jira.transitionIssue(issueId, { transition: { id: transition.id } });
}

/**
 * Helper function to edit a certain field on a certain issue.
 *
 * We use a custom request here because the Jira client doesn't know how to do this.
 *
 * @param {string} issue - The issue ID to edit
 * @param {string} field - The field to edit
 * @param {string} value - The value to set
 */
async function editIssueField(issue, field, value) {
  console.log(
    `📝 Editing field ${JSON.stringify(field)} on issue ${JSON.stringify(issue)} with value ${JSON.stringify(value)}...`,
  );

  await fetch(`https://${config.api.host}/rest/api/2/issue/${issue}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.api.email}:${config.api.token}`,
      ).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Force-Accept-Language": true,
      "Accept-Language": "en-US",
    },
    body: JSON.stringify({
      fields: { [field]: value },
    }),
  });
}

/**
 * Marks the passed issues to a certain state
 *
 * @param {JiraApi} jira - The Jira Client instance
 * @param {string[]} issues - The issue IDs to change
 * @param {keyof typeof statuses} stateName - The state to change to
 */
async function markAsState(jira, issues, stateName) {
  console.log(`🏃 Marking issues ${issues} as ${stateName}...`);
  await Promise.all(
    issues.map(async (issue) => await transitionIssue(jira, issue, stateName)),
  );
}

/**
 * Helper function to remove emojis
 *
 * @param {string} content The string to format
 * @returns {string} Cleaned up string
 */
function removeEmoji(content) {
  let conByte = new TextEncoder("utf-8").encode(content);
  for (let i = 0; i < conByte.length; i++) {
    if ((conByte[i] & 0xf8) == 0xf0) {
      for (let j = 0; j < 4; j++) {
        conByte[i + j] = 0x30;
      }
      i += 3;
    }
  }
  content = new TextDecoder("utf-8").decode(conByte);
  return content.replaceAll("0000", "");
}

/** Helper to update the PR description
 *
 * @param {JiraApi} jira - The Jira Client instance
 */
async function updateIssueDescription(jira) {
  const issue = await jira.getIssue(config.ticketKeys[0]);

  const prTickets = await getPrTickets();

  // Update the PR Description
  const designFieldValue = issue.fields[jiraFields.DESIGN_LINK] ?? "";
  const mockupLink = `[ ${designFieldValue.displayName} ](${designFieldValue.url})`;

  const components = issue.fields.components
    .reduce((prev, c) => [...prev, c.name.split(" ")[1].toLowerCase()], [])
    .join("|");
  const componentsTitle = components === "" ? "" : `(${components})`;

  const title = `${issue.fields.issuetype.name.toLowerCase()}${componentsTitle}: ${removeEmoji(
    issue.fields.summary,
  ).trim()} | ${issue.key} ${prTickets.join(" ")}`;

  const description = `

## [${issue.key}](https://${config.api.host}/browse/${issue.key}/) | ${issue.fields.summary}

| Info | Value |
|------|-------|
| Issue Type | ![](${issue.fields.issuetype.iconUrl}) ${issue.fields.issuetype.name} | 
| Assignee | ![](${issue.fields.assignee.avatarUrls["16x16"]}) ${issue.fields.assignee.displayName} |
| Priority | <img src="${issue.fields.priority.iconUrl}" width="16px" height="16px" /> ${issue.fields.priority.name} |
| Components | ${issue.fields.components.map((c) => c.name).join(" ")} |
| Product Area | ${(issue.fields[jiraFields.PRODUCT_AREA] ?? { value: "N/A" }).value} |
| Clients | ${(issue.fields[jiraFields.CLIENTS] ?? []).map((f) => f.value).join(", ")} |
| Mockup | ${mockupLink.includes("undefined") ? "Not Available" : mockupLink} |
| Tickets in this PR | ${prTickets.join(",")} |

---

${j2m.to_markdown(issue.fields.description ?? "")}

<details>
  <summary> 💬 ${issue.fields.comment.comments.length} Comments </summary>

  <table>
  ${(await Promise.all(issue.fields.comment.comments.map(parseComment))).join("\n")}
  </table>
</details>
`;

  if (config.prNumber !== "") {
    await editIssueField(
      issue.key,
      jiraFields.PR_LINK,
      `https://github.com/${config.repoName}/pull/${config.prNumber}/`,
    );
    try {
      await editPrDescription(title, description, config.prNumber);
    } catch (e) {
      console.error(e);
      console.error("Error editing PR description - bailing");
    }
  }
}

/**
 * Helper function to ensure a certain release version exists
 *
 * @param {JiraApi} jira - The Jira Client instance
 * @param {string} version - The version to check
 * @param {boolean} markAsReleased - Whether to mark the version as released as well
 * @returns {Promise<number>} The release version ID
 */
async function ensureReleaseExists(jira, version, markAsReleased) {
  console.log(`📋 Ensuring release version ${config.releaseVersion} exists...`);

  const projectKey = config.ticketKeys
    ? config.ticketKeys[0].split("-")[0]
    : "FN";
  const project = await jira.getProject(projectKey);

  const releases = await jira.getVersions(projectKey);

  const existingRelease = releases.find(
    (r) => r.name === version && r.projectId == project.id,
  );
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0"); // Months are zero-based, so add 1
  const day = String(today.getDate()).padStart(2, "0"); // Pad single digit days with a leading zero

  const formattedDate = process.env.RELEASE_DATE ?? `${year}-${month}-${day}`;
  if (existingRelease) {
    const startDate = process.env.START_DATE ?? existingRelease.startDate;

    console.log(`✅ Release exists, marking release as done and returning ID`);
    await jira.updateVersion({
      id: existingRelease.id,
      startDate,
      released: markAsReleased,
      releaseDate: formattedDate,
    });
    return existingRelease.id;
  }

  console.log("🔍 Release does not exist, creating...");
  const response = await jira.createVersion({
    name: version,
    description: `✨ New Footprint release`,
    projectId: project.id,
    startDate: formattedDate,
    released: markAsReleased,
  });

  return response.id;
}

/**
 * Helper function to get FN numbers on a PR's branch
 *
 * @returns {string[]} List of FN tickets
 */
async function getPrTickets() {
  try {
    if (!config.prNumber || config.prNumber === "") {
      console.error("⚠️  No PR number - returning 0 tickets");
      return [];
    }

    const octo = await getOctoClient();

    const pr = await octo.rest.pulls.get({
      owner: config.repoName.split("/")[0],
      repo: config.repoName.split("/")[1],
      pull_number: config.prNumber,
    });

    let page = 1;
    let latestCommits = [];
    let response;

    do {
      console.log(
        `\tGetting page ${page} of commits for PR ${config.prNumber}...`,
      );

      response = await octo.rest.repos.listCommits({
        owner: config.repoName.split("/")[0],
        repo: config.repoName.split("/")[1],
        sha: pr.data.head.ref,
        page,
        per_page: 100,
      });

      const commitsMessages = response.data.commits.map((c) => {
        if (!c.commit) {
          return "";
        }
        return c.commit.message;
      });

      latestCommits = [...latestCommits, ...commitsMessages];
      page++;
    } while (response.data.commits.length > 0);

    return latestCommits.join("\n");
  } catch (e) {
    console.error(e);
    console.error("Error returning PR tickets");
    return [];
  }
}
