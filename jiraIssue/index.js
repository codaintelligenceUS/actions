import { getInput, setFailed } from "@actions/core";
import JiraApi from "jira-client";
import { Octokit } from "octokit";
import j2m from "jira2md";

const jiraTicketRegex = /\bFN-\d+\b/g;

const jiraFields = {
  DESIGN_LINK: "customfield_10558",
  PRODUCT_AREA: "customfield_10571",
  CLIENTS: "customfield_10566",
  PR_LINK: "customfield_10574",
};

const config = {
  api: {
    protocol: "https",
    host: getInput("jira_host"),
    email: getInput("jira_email"),
    token: getInput("jira_token"),
  },
  ticketKeys: getInput("ticket_keys").match(jiraTicketRegex),
  actionToTake: getInput("action_to_take"),
  prNumber: getInput("pr_number"),
  releaseVersion: getInput("release_version"),
  repoName: getInput("repo_name"),
  ghToken: getInput("gh_token"),
  testerUsernames: getInput("tester_usernames").split(","),
};

const actionsToTake = {
  markAsInProgressOrInReview,
  markAsInTesting,
  markAsTestingRejected: () => {
    /** */
  },
  markAsDeployedToDev: () => {
    /** */
  },
  markAsDeployedToStaging: () => {
    /** */
  },
  markAsDeployedToProduction: () => {
    /** */
  },
};

async function main() {
  try {
    console.log("📋 Validating requested action is valid");
    const validActions = Object.keys(actionsToTake);

    if (!validActions.includes(config.actionToTake)) {
      console.error(
        `‼️  Requested action ${config.actionToTake} is not valid. Valid actions are: \n * ${validActions.join("\n * ")}`,
      );
      process.exit(-1);
    }

    console.log("🔌 Connecting to Jira...");
    const jira = new JiraApi({
      protocol: config.api.protocol,
      host: config.api.host,
      username: config.api.email,
      password: config.api.token,
    });

    const actionFunction = actionsToTake[config.actionToTake];

    await actionFunction(jira);
  } catch (error) {
    setFailed(error.message);
  }
}

/**
 * Marks the passed issues as in progress
 *
 * @param {JiraApi} jira API Client for jira
 */
async function markAsInProgressOrInReview(jira) {
  if (config.prNumber !== "") {
    console.warn("PR Number found, checking if it is draft");
    const pr = await getPrInfo();

    if (!pr.data.draft) {
      console.warn("PR is marked as open - transitioning issue to In Review");
      await markAsState(jira, config.ticketKeys, "In Review");
    } else {
      await markAsState(jira, config.ticketKeys, "In Progress");
    }
  }

  const issue = await jira.getIssue(config.ticketKeys[0]);

  // Update the PR Description
  const mockupLink =
    issue.fields.customfield_10558.length === 0
      ? "None available"
      : `[ ${issue.fields[jiraFields.DESIGN_LINK][0].displayName} ](${issue.fields[jiraFields.DESIGN_LINK][0].url})`;

  const components = issue.fields.components
    .reduce((prev, c) => [...prev, c.name.split(" ")[1].toLowerCase()], [])
    .join("|");
  const componentsTitle = components === "" ? "" : `(${components})`;

  const title = `${issue.fields.issuetype.name.toLowerCase()}${componentsTitle}: ${removeEmoji(
    issue.fields.summary,
  ).trim()} | ${issue.key}`;

  const description = `

## [${issue.key}](https://${config.api.host}/browse/${issue.key}/) | ${issue.fields.summary}

| Info | Value |
|------|-------|
| Issue Type | ![](${issue.fields.issuetype.iconUrl}) ${issue.fields.issuetype.name} | 
| Assignee | ![](${issue.fields.assignee.avatarUrls["16x16"]}) ${issue.fields.assignee.displayName} |
| Priority | <img src="${issue.fields.priority.iconUrl}" width="16px" height="16px" /> ${issue.fields.priority.name} |
| Components | ${issue.fields.components.map((c) => c.name).join(" ")} |
| Product Area | ${issue.fields[jiraFields.PRODUCT_AREA].value} |
| Clients | ${issue.fields[jiraFields.CLIENTS].map((f) => f.value).join(", ")} |
| Mockup | ${mockupLink} |

---

${j2m.to_markdown(issue.fields.description)}`;

  await editPrDescription(title, description);
  await editIssueField(
    issue.key,
    jiraFields.PR_LINK,
    `https://github.com/${config.repoName}/pull/${config.prNumber}/`,
  );
}

/**
 * Marks the passed issue as in testing, if the specified reviewer is passed. If not, it bails
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

  const pr = await getPrInfo();

  if (pr.data.draft) {
    console.error(
      "⚠️  Specified PR is marked as Draft. Exiting without editing.",
    );
    process.exit(0);
  }

  const issue = await jira.getIssue(config.ticketKeys[0]);

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

  await markAsState(jira, config.ticketKeys, "In Testing");
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
 */
async function getPrInfo() {
  console.log("🎋 Getting PR info...");
  const octo = await getOctoClient();

  return await octo.rest.pulls.get({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    pull_number: config.prNumber,
  });
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

  return response.data.users;
}

/**
 * Helper to edit the description of the current Promise.reject(
 *
 * @param {string} title The new PR title to set
 * @param {string} description The new PR description to edit
 */
async function editPrDescription(title, description) {
  console.log("📝 Editing PR description...");
  const octo = await getOctoClient();
  await octo.rest.pulls.update({
    owner: config.repoName.split("/")[0],
    repo: config.repoName.split("/")[1],
    pull_number: config.prNumber,
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
 * Helper function to transition an issue to a certain state
 *
 * @param {JiraApi} jira - The Jira Client instance
 * @param {string} issueId - The issue ID to change
 * @param {string} stateName - The state to change to
 */
async function transitionIssue(jira, issueId, stateName) {
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
    `📝 Editing field ${field} on issue ${issue} with value ${value}...`,
  );

  const response = await fetch(
    `https://${config.api.host}/rest/api/2/issue/${issue}`,
    {
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
    },
  );
}

/**
 * Marks the passed issues to a certain state
 *
 * @param {JiraApi} jira - The Jira Client instance
 * @param {string[]} issues - The issue IDs to change
 * @param {string} stateName - The state to change to
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
