const core = require("@actions/core");
const { Jira } = require("jira-changelog");

const config = {
  jira: {
    api: {
      host: core.getInput("jira_host"),
      email: core.getInput("jira_email"),
      token: core.getInput("jira_token"),
    },
    ticketKey: core.getInput("ticket_key"),
  },
};

async function main() {
  try {
    const jira = new Jira(config);

    const ticket = await jira.getJiraIssue(config.jira.ticketKey);

    console.log(ticket.key);
    console.log(ticket.fields.summary);
    console.log(ticket.fields.issuetype.name);
    console.log(ticket.fields.components[0]);

    core.setOutput("ticketKey", ticket.key);
    core.setOutput("ticketSummary", ticket.fields.summary);
    core.setOutput("ticketIssueType", ticket.fields.issuetype.name);
    core.setOutput("ticketComponent", ticket.fields.components[0].name);

    const components = ticket.fields.components
      .reduce((prev, c) => [...prev, c.name.split(" ")[1].toLowerCase()], "")
      .join("|");
    const componentsTitle = components === "" ? "" : `(${components})`;

    core.setOutput(
      "pullRequestTitle",
      `${ticket.fields.issuetype.name.toLowerCase()}${componentsTitle}:${
        ticket.fields.summary
      } | ${ticket.key}`,
    );

    return;
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
