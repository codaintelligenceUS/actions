const core = require("@actions/core");
const _ = require("lodash");
const Entities = require("html-entities");
const ejs = require("ejs");
const { SourceControl, Jira } = require("jira-changelog");
const RegExpFromString = require("regexp-from-string");

const config = {
  jira: {
    api: {
      host: core.getInput("jira_host"),
      email: core.getInput("jira_email"),
      token: core.getInput("jira_token"),
    },
    baseUrl: core.getInput("jira_base_url"),
    ticketIDPattern: RegExpFromString(core.getInput("jira_ticket_id_pattern")),
    approvalStatus: core
      .getInput("approval_statuses")
      .split(",")
      .filter((x) => x !== ""),
    excludeIssueTypes: core
      .getInput("exclude_issue_types")
      .split(",")
      .filter((x) => x !== ""),
    includeIssueTypes: [],
    excludeLabel: core.getInput("exclude_label"),
  },
  sourceControl: {
    defaultRange: {
      from: core.getInput("source_control_range_from"),
      to: core.getInput("source_control_range_to"),
    },
  },
  extraContent: core.getInput("extra_content", { required: false }),
};

const template = `
<% if (jira.releaseVersions && jira.releaseVersions.length) {  %>
Release version: <%= jira.releaseVersions[0].name -%>
<% } %>

<% if (extraContent) { %>
  <%= extraContent -%>
<% } %>

Jira Tickets
---------------------
<% tickets.approved.forEach((ticket) => { %>
  * ![](<%= ticket.fields.issuetype.iconUrl %> "<%= ticket.fields.issuetype.name %>") **<%= ticket.fields.issuetype.name %>** [<%= ticket.key %>](<%= jira.baseUrl + '/browse/' + ticket.key %>) <% ticket.fields.components && ticket.fields.components.length > 0 && ticket.fields.components.map((component) => { %> **<%= component.name %>**  <% }).join(', ') %>  <%= ticket.fields.summary -%>
<% }); -%>
<% if (!tickets.approved.length) {%> No JIRA tickets present in this release <% } %>

`;

const trimmedTemplate = `
<% if (extraContent) { %>
<%= extraContent -%>
<% } %>

<% if (currentDate) { %>
<%= currentDate -%>
<% } %>

**Jira Tickets**

<% tickets.approved.forEach((ticket) => { %>
  * **<%= ticket.fields.issuetype.name %>** <% ticket.fields.components && ticket.fields.components.length > 0 && ticket.fields.components.map((component) => { %> <%= component.name %> <% }).join(', ') %>  <%= ticket.fields.summary -%>
<% }); -%>
<% if (!tickets.approved.length) {%> No JIRA tickets present in this release <% } %>
`;

const trimmedTemplateTeams = `
<% if (jira.releaseVersions && jira.releaseVersions.length) {  %>
Release version: <%= jira.releaseVersions[0].name -%>
<% } %>

<% if (extraContent) { %>
  <%= extraContent -%>
<% } %>

**Jira Tickets**

<% tickets.approved.forEach((ticket) => { %>
  * **<%= ticket.fields.issuetype.name %>** [<%= ticket.key %>](<%= jira.baseUrl + '/browse/' + ticket.key %>) <% ticket.fields.components && ticket.fields.components.length > 0 && ticket.fields.components.map((component) => { %> <%= component.name %> <% }).join(', ') %>  <%= ticket.fields.summary -%>
<% }); -%>
<% if (!tickets.approved.length) {%> No JIRA tickets present in this release <% } %>
`;

function generateReleaseVersionName() {
  const hasVersion = process.env.VERSION;
  if (hasVersion) {
    return process.env.VERSION;
  } else {
    return "";
  }
}

function transformCommitLogs(config, logs) {
  let approvalStatus = config.jira.approvalStatus;
  if (!Array.isArray(approvalStatus)) {
    approvalStatus = [approvalStatus];
  }

  // Tickets and their commits
  const ticketHash = logs.reduce((all, log) => {
    log.tickets.forEach((ticket) => {
      all[ticket.key] = all[ticket.key] || ticket;
      all[ticket.key].commits = all[ticket.key].commits || [];
      all[ticket.key].commits.push(log);
    });
    return all;
  }, {});

  const ticketList = _.sortBy(
    Object.values(ticketHash),
    (ticket) => ticket.fields.issuetype.name,
  );

  let pendingTickets = ticketList.filter(
    (ticket) => !approvalStatus.includes(ticket.fields.status.name),
  );

  // Pending ticket owners and their tickets/commits
  const reporters = {};
  pendingTickets.forEach((ticket) => {
    const email = ticket.fields.reporter.emailAddress;
    if (!reporters[email]) {
      reporters[email] = {
        email,
        name: ticket.fields.reporter.displayName,
        slackUser: ticket.slackUser,
        tickets: [ticket],
      };
    } else {
      reporters[email].tickets.push(ticket);
    }
  });
  const pendingByOwner = _.sortBy(
    Object.values(reporters),
    (item) => item.user,
  );

  // Output filtered data
  return {
    commits: {
      all: logs,
      tickets: logs.filter((commit) => commit.tickets.length),
      noTickets: logs.filter((commit) => !commit.tickets.length),
    },
    tickets: {
      pendingByOwner,
      all: ticketList,
      approved: ticketList.filter((ticket) =>
        approvalStatus.includes(ticket.fields.status.name) && !ticket.fields.labels.includes("Internal"),
      ),
      pending: pendingTickets,
    },
  };
}

async function main() {
  try {
    const currentDate = new Date()
      .toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
      .split(" ")
      .join(" ");

    // Get commits for a range
    const source = new SourceControl(config);
    const jira = new Jira(config);

    const range = config.sourceControl.defaultRange;
    console.log(`Getting range ${range.from}...${range.to} commit logs`);
    const commitLogs = await source.getCommitLogs("./", range);
    console.log("Found following commit logs:");
    console.log(commitLogs);

    console.log("Generating release version");
    const release = generateReleaseVersionName();
    console.log(`Release: ${release}`);

    console.log("Reading extra content, if available");
    const hasPGPkey =
      config.extraContent.indexOf("-----BEGIN PGP SIGNATURE-----") > -1;

    const extraContent = hasPGPkey
      ? config.extraContent.slice(
          0,
          config.extraContent.indexOf("-----BEGIN PGP SIGNATURE-----"),
        )
      : config.extraContent;
    console.log(`Extra Content: ${extraContent}`);

    console.log("Generating Jira changelog from commit logs");
    const changelog = await jira.generate(commitLogs, release);
    console.log("Changelog entry:");
    console.log(changelog);

    console.log("Generating changelog message");
    const data = await transformCommitLogs(config, changelog);

    data.jira = {
      baseUrl: config.jira.baseUrl,
      releaseVersions: jira.releaseVersions,
    };
    data.includePendingApprovalSection =
      core.getInput("include_pending_approval_section") === "true";
    data.extraContent = extraContent;
    data.currentDate = currentDate;

    const entitles = new Entities.AllHtmlEntities();
    const changelogMessage = ejs.render(template, data);
    const trimmedChangelogMessage = ejs.render(trimmedTemplate, data);
    const trimmedChangelogMessageTeams = ejs.render(trimmedTemplateTeams, data);

    console.log("Changelog message entry:");
    console.log(entitles.decode(changelogMessage));

    console.log("Changelog trimmed message entry:");
    console.log(entitles.decode(trimmedChangelogMessage));

    core.setOutput("changelog_message", changelogMessage);

    core.setOutput("changelog_message_trimmed", trimmedChangelogMessage);

    core.setOutput(
      "changelog_message_trimmed_teams",
      JSON.stringify(trimmedChangelogMessageTeams).slice(
        1,
        JSON.stringify(trimmedChangelogMessageTeams).length - 1,
      ),
    );
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
