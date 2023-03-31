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
async function main() {
  try {
    const jira = new Jira(config);

    const ticket = await jira.getJiraIssue(config.jira.ticketKey);

    console.log(ticket.key);
    console.log(ticket.fields.summary);
    console.log(ticket.fields.issuetype.name);
    console.log(ticket.fields.components[0]);

    const components = ticket.fields.components
      .reduce((prev, c) => [...prev, c.name.split(" ")[1].toLowerCase()], [])
      .join("|");
    const componentsTitle = components === "" ? "" : `(${components})`;

    core.setOutput(
      "pullRequestTitle",
      `${ticket.fields.issuetype.name.toLowerCase()}${componentsTitle}: ${removeEmoji(
        ticket.fields.summary,
      ).trim()} | ${ticket.key}`,
    );

    return;
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
