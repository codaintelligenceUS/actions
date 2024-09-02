# Jira Issue editor

This action serves as a central point for syncing statuses between the GitHub workflows and Jira

This action expects an `action_to_take` parameter that can take the following options:

- `checkForTesterApproval` - Checks if the passed PR has at least one approval from a tester. If not, it fails.
- `markAsInProgressOrInReview` - Updates the passed issue's state to `In Progress` or `In Review`, depending if it has an open PR associated to it or not. This is intended to be run on every push of a feature branch.
- `markAsInTesting` - Updates the passed issue's state to `In Testing` if a tester has been added to review
- `markAsTestingRejected` - Updates the passed issue's state to `Testing Rejected`
- `markAsDeployedToDev` - Updates the passed issue's state to `Deployed to development`
- `markAsDeployedToStaging` - Updates the passed issue's state to `Deployed to staging`, and also assigned the passed `releaseVersion` parameter as the Release field
  - ! The `release_version` field is required if this parameter is called
- `markAsDeployedToProduction` - Updates the passed issue's state to `Deployed to production`, and marks the release as Released
  - ! The `release_version` field is required if this parameter is called
