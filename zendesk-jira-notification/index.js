const zendesk = require("node-zendesk");
const core = require("@actions/core");
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: core.getInput("github_token")
});

const zendeskClient = zendesk.createClient({
  username: core.getInput("zendesk_username"),
  token: core.getInput("zendesk_token"),
  remoteUri: core.getInput("zendesk_uri")
});

async function getChangelog() {
  const changelog = await octokit.request(
    "GET /repos/{owner}/{repo}/releases/latest",
    {
      owner: core.getInput("github_owner"),
      repo: core.getInput("github_repo"),
      Headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  return { body: changelog.data.body, tag: changelog.data.tag_name };
}

function getJiraTickets(changelog) {
  let tickets = [...changelog.matchAll(/\[FN-\d+\]/g)];

  return tickets.map((ticket) => ticket[0].replace("[", "").replace("]", ""));
}

async function getZendeskTickets() {
  let zendeskTickets = await zendeskClient.tickets.list();

  // 9808808323100 = Jira Ticket Custom Field ID
  zendeskTickets = zendeskTickets.map((ticket) => ({
    zendeskTicketid: ticket.id,
    jiraTicketId: ticket.fields.find((field) => field.id === 9808808323100).value,
  }));

  return zendeskTickets.filter((ticket) => !!ticket.jiraTicketId);
}

async function updateTicket(zendeskTicketId, versionTag) {
  let notificationMessage = `
    We are thrilled to inform you that this issue has been resolved in Footprint v${versionTag} which has just been released.
    Looking forward to your confirmation that we indeed solved your issue. Meanwhile, we will keep this ticket as \`Pending\`, until we hear back from you. If you experience any further questions or issues, please reply back to us.
    Thank you for contacting support and helping us build a better product!

    This is an automated message.
    `;

    zendeskClient.tickets.update(zendeskTicketId, 
      {
        "ticket": {
          comment: { 
            "body": notificationMessage,
            "public": true
          },
          "status": "pending"
        }
      }, (err, req, res) => {
        if(!err) {
          console.log('Ticket ' + zendeskTicketId + ' updated!')
        }
      }
    )}

async function main() {
  try {
    const changelog = await getChangelog();

    const jiraTickets = getJiraTickets(changelog.body);

    const zendeskTickets = await getZendeskTickets();

    const ticketsToUpdate = zendeskTickets.filter((ticket) => {
      if ( jiraTickets.some((jiraTicket) => jiraTicket === ticket.jiraTicketId) ) {
        return ticket;
      }
    });

    for (const ticket of ticketsToUpdate) {
      updateTicket(ticket.zendeskTicketid, changelog.tag);
    }

  } catch (error) {
    console.log(error);
  }
}

main();
