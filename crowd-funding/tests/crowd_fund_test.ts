import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

Clarinet.test({
    name: "Ensure that campaign creation works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!;

        // Set goal and deadline
        const goal = 1000000000; // 1000 STX
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));
        const deadline = currentTimeValue + 86400; // 1 day from now

        // Create a campaign
        let block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Check if campaign creation was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok u0)'); // First campaign ID

        // Verify campaign details
        const campaignDetails = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-details',
            [types.uint(0)],
            user1.address
        );

        const detailsString = campaignDetails.result.replace('(some ', '').slice(0, -1);
        assertEquals(detailsString.includes(`owner: ${user1.address}`), true);
        assertEquals(detailsString.includes(`goal: u${goal}`), true);
        assertEquals(detailsString.includes('raised: u0'), true);
        assertEquals(detailsString.includes(`deadline: u${deadline}`), true);
        assertEquals(detailsString.includes('claimed: false'), true);

        // Test campaign with invalid goal (0)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(0), types.uint(deadline)],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u103)'); // err-invalid-amount

        // Test campaign with deadline in the past
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(currentTimeValue - 86400)],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u104)'); // err-deadline-passed
    },
});

Clarinet.test({
    name: "Ensure that contribution to campaigns works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!; // Campaign creator
        const user2 = accounts.get('wallet_2')!; // Contributor

        // Get current time
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));

        // Create a campaign
        const goal = 100000000; // 100 STX
        const deadline = currentTimeValue + 86400; // 1 day from now

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Contribute to the campaign
        const contributionAmount = 50000000; // 50 STX
        let block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(0), types.uint(contributionAmount)],
                user2.address
            )
        ]);

        // Check if contribution was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify campaign raised amount was updated
        const campaignDetails = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-details',
            [types.uint(0)],
            user1.address
        );

        const detailsString = campaignDetails.result.replace('(some ', '').slice(0, -1);
        assertEquals(detailsString.includes(`raised: u${contributionAmount}`), true);

        // Verify contribution was recorded
        const contributionDetails = chain.callReadOnlyFn(
            'crowd_fund',
            'get-contribution',
            [types.uint(0), types.principal(user2.address)],
            user2.address
        );

        const contributionString = contributionDetails.result.replace('(some ', '').slice(0, -1);
        assertEquals(contributionString.includes(`amount: u${contributionAmount}`), true);

        // Test another contribution from the same user
        const additionalAmount = 20000000; // 20 STX
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(0), types.uint(additionalAmount)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify total contribution amount was updated
        const updatedContribution = chain.callReadOnlyFn(
            'crowd_fund',
            'get-contribution',
            [types.uint(0), types.principal(user2.address)],
            user2.address
        );

        const updatedString = updatedContribution.result.replace('(some ', '').slice(0, -1);
        assertEquals(updatedString.includes(`amount: u${contributionAmount + additionalAmount}`), true);

        // Test contribution to non-existent campaign
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(999), types.uint(10000000)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u101)'); // err-not-found

        // Test contribution with invalid amount (0)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(0), types.uint(0)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u103)'); // err-invalid-amount
    },
});

Clarinet.test({
    name: "Ensure that campaign status and statistics functions work correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!; // Campaign creator
        const user2 = accounts.get('wallet_2')!; // Contributor

        // Get current time
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));

        // Create a campaign
        const goal = 100000000; // 100 STX
        const deadline = currentTimeValue + 86400; // 1 day from now

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Check campaign progress (should be 0%)
        let progressResult = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-progress',
            [types.uint(0)],
            user1.address
        );

        assertEquals(progressResult.result, '(ok u0)');

        // Contribute 50% of the goal
        const contributionAmount = 50000000; // 50 STX
        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(0), types.uint(contributionAmount)],
                user2.address
            )
        ]);

        // Check campaign progress (should be 50%)
        progressResult = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-progress',
            [types.uint(0)],
            user1.address
        );

        assertEquals(progressResult.result, '(ok u50)');

        // Check campaign time left
        const timeLeftResult = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-time-left',
            [types.uint(0)],
            user1.address
        );

        // Time left should be approximately one day (86400 seconds)
        const timeLeftString = timeLeftResult.result;
        assertEquals(timeLeftString.startsWith('(ok u'), true);

        // Test campaign success check (should be false, deadline not reached)
        const successResult = chain.callReadOnlyFn(
            'crowd_fund',
            'is-campaign-successful',
            [types.uint(0)],
            user1.address
        );

        assertEquals(successResult.result, 'false');

        // Contribute the remaining amount to reach the goal
        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(0), types.uint(contributionAmount)],
                user2.address
            )
        ]);

        // Check progress again (should be 100%)
        progressResult = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-progress',
            [types.uint(0)],
            user1.address
        );

        assertEquals(progressResult.result, '(ok u100)');

        // Campaign still not successful because deadline not reached
        const successResultAfterFunding = chain.callReadOnlyFn(
            'crowd_fund',
            'is-campaign-successful',
            [types.uint(0)],
            user1.address
        );

        assertEquals(successResultAfterFunding.result, 'false');

        // Fast forward to after the deadline
        chain.mineEmptyBlockUntil(deadline + 1);

        // Now campaign should be successful
        const successResultAfterDeadline = chain.callReadOnlyFn(
            'crowd_fund',
            'is-campaign-successful',
            [types.uint(0)],
            user1.address
        );

        assertEquals(successResultAfterDeadline.result, 'true');

        // Check time left after deadline (should be 0)
        const timeLeftAfterDeadline = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-time-left',
            [types.uint(0)],
            user1.address
        );

        assertEquals(timeLeftAfterDeadline.result, '(ok u0)');
    },
});

Clarinet.test({
    name: "Ensure that claiming funds works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!; // Campaign creator
        const user2 = accounts.get('wallet_2')!; // Contributor

        // Get current time
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));

        // Create a campaign
        const goal = 100000000; // 100 STX
        const deadline = currentTimeValue + 86400; // 1 day from now

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Contribute to meet the goal
        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(0), types.uint(goal)],
                user2.address
            )
        ]);

        // Try to claim before deadline (should fail)
        let block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'claim-funds',
                [types.uint(0)],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u104)'); // err-deadline-passed

        // Fast forward to after the deadline
        chain.mineEmptyBlockUntil(deadline + 1);

        // Claim the funds
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'claim-funds',
                [types.uint(0)],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify campaign is marked as claimed
        const campaignDetails = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-details',
            [types.uint(0)],
            user1.address
        );

        const detailsString = campaignDetails.result.replace('(some ', '').slice(0, -1);
        assertEquals(detailsString.includes('claimed: true'), true);

        // Try to claim again (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'claim-funds',
                [types.uint(0)],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u106)'); // err-already-claimed

        // Try to claim as non-owner (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'claim-funds',
                [types.uint(0)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only
    },
});

Clarinet.test({
    name: "Ensure that refunds work correctly for unsuccessful campaigns",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!; // Campaign creator
        const user2 = accounts.get('wallet_2')!; // Contributor

        // Get current time
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));

        // Create a campaign
        const goal = 100000000; // 100 STX
        const deadline = currentTimeValue + 86400; // 1 day from now

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Contribute less than the goal
        const contributionAmount = 50000000; // 50 STX (half of the goal)
        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(0), types.uint(contributionAmount)],
                user2.address
            )
        ]);

        // Try to get refund before deadline (should fail)
        let block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'refund',
                [types.uint(0)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u104)'); // err-deadline-passed

        // Fast forward to after the deadline
        chain.mineEmptyBlockUntil(deadline + 1);

        // Get refund (should succeed as goal was not met)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'refund',
                [types.uint(0)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify contribution is removed
        const contributionDetails = chain.callReadOnlyFn(
            'crowd_fund',
            'get-contribution',
            [types.uint(0), types.principal(user2.address)],
            user2.address
        );

        assertEquals(contributionDetails.result, 'none');

        // Try to get refund again (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'refund',
                [types.uint(0)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u101)'); // err-not-found

        // Create a new campaign and fully fund it
        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(currentTimeValue + 86400)],
                user1.address
            )
        ]);

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'contribute',
                [types.uint(1), types.uint(goal)],
                user2.address
            )
        ]);

        // Fast forward to after the deadline
        chain.mineEmptyBlockUntil(currentTimeValue + 86400 + 1);

        // Try to get refund for successful campaign (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'refund',
                [types.uint(1)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u105)'); // err-goal-not-reached
    },
});

Clarinet.test({
    name: "Ensure milestones can be added and completed correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!; // Campaign creator
        const user2 = accounts.get('wallet_2')!; // Random user

        // Get current time
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));

        // Create a campaign
        const goal = 100000000; // 100 STX
        const deadline = currentTimeValue + 86400; // 1 day from now

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Add milestone
        const milestoneTitle = "First Milestone";
        const milestoneDescription = "This is the first milestone of the campaign";
        const milestoneTarget = 30000000; // 30 STX
        const milestoneDeadline = currentTimeValue + 43200; // 12 hours from now

        let block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'add-campaign-milestone',
                [
                    types.uint(0),
                    types.utf8(milestoneTitle),
                    types.utf8(milestoneDescription),
                    types.uint(milestoneTarget),
                    types.uint(milestoneDeadline)
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Retrieve milestone details
        const milestoneDetails = chain.callReadOnlyFn(
            'crowd_fund',
            'get-milestone-details',
            [types.uint(0), types.uint(0)],
            user1.address
        );

        const milestoneString = milestoneDetails.result.replace('(some ', '').slice(0, -1);
        assertEquals(milestoneString.includes(`title: "${milestoneTitle}"`), true);
        assertEquals(milestoneString.includes(`description: "${milestoneDescription}"`), true);
        assertEquals(milestoneString.includes(`target-amount: u${milestoneTarget}`), true);
        assertEquals(milestoneString.includes('completed: false'), true);

        // Try to add milestone as non-owner (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'add-campaign-milestone',
                [
                    types.uint(0),
                    types.utf8("Unauthorized Milestone"),
                    types.utf8("This should fail"),
                    types.uint(10000000),
                    types.uint(milestoneDeadline)
                ],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only

        // Mark milestone as completed
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'complete-milestone',
                [types.uint(0), types.uint(0)],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify milestone is marked as completed
        const updatedMilestone = chain.callReadOnlyFn(
            'crowd_fund',
            'get-milestone-details',
            [types.uint(0), types.uint(0)],
            user1.address
        );

        const updatedMilestoneString = updatedMilestone.result.replace('(some ', '').slice(0, -1);
        assertEquals(updatedMilestoneString.includes('completed: true'), true);

        // Try to complete milestone as non-owner (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'complete-milestone',
                [types.uint(0), types.uint(0)],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only
    },
});

Clarinet.test({
    name: "Ensure campaign updates can be posted correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!; // Campaign creator
        const user2 = accounts.get('wallet_2')!; // Random user

        // Get current time
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));

        // Create a campaign
        const goal = 100000000; // 100 STX
        const deadline = currentTimeValue + 86400; // 1 day from now

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Post an update
        const updateTitle = "Campaign Progress";
        const updateContent = "We're making good progress on our campaign goals. Thanks to all supporters!";

        let block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'post-campaign-update',
                [
                    types.uint(0),
                    types.utf8(updateTitle),
                    types.utf8(updateContent)
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Retrieve update details
        const updateDetails = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-update',
            [types.uint(0), types.uint(0)],
            user1.address
        );

        const updateString = updateDetails.result.replace('(some ', '').slice(0, -1);
        assertEquals(updateString.includes(`title: "${updateTitle}"`), true);
        assertEquals(updateString.includes(`content: "${updateContent}"`), true);
        assertEquals(updateString.includes('timestamp: u'), true);

        // Check campaign stats
        const campaignStats = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-statistics',
            [types.uint(0)],
            user1.address
        );

        const statsString = campaignStats.result.replace('(some ', '').slice(0, -1);
        assertEquals(statsString.includes('updates-count: u1'), true);

        // Try to post update as non-owner (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'post-campaign-update',
                [
                    types.uint(0),
                    types.utf8("Unauthorized Update"),
                    types.utf8("This should fail")
                ],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u100)'); // err-owner-only

        // Post another update
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'post-campaign-update',
                [
                    types.uint(0),
                    types.utf8("Second Update"),
                    types.utf8("More progress to report!")
                ],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Check updated campaign stats
        const updatedStats = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-statistics',
            [types.uint(0)],
            user1.address
        );

        const updatedStatsString = updatedStats.result.replace('(some ', '').slice(0, -1);
        assertEquals(updatedStatsString.includes('updates-count: u2'), true);
    },
});

Clarinet.test({
    name: "Ensure campaign reporting system works correctly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!; // Campaign creator
        const user2 = accounts.get('wallet_2')!; // Reporter

        // Get current time
        const currentTime = chain.callReadOnlyFn(
            'crowd_fund',
            'current-time',
            [],
            deployer.address
        );
        const currentTimeValue = Number(currentTime.result.slice(1));

        // Create a campaign
        const goal = 100000000; // 100 STX
        const deadline = currentTimeValue + 86400; // 1 day from now

        chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'create-campaign',
                [types.uint(goal), types.uint(deadline)],
                user1.address
            )
        ]);

        // Report the campaign
        const reportReason = "Campaign seems suspicious and the goals are unclear";

        let block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'report-campaign',
                [
                    types.uint(0),
                    types.utf8(reportReason)
                ],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Retrieve report status
        const reportStatus = chain.callReadOnlyFn(
            'crowd_fund',
            'get-campaign-report-status',
            [types.uint(0), types.principal(user2.address)],
            user2.address
        );

        const reportString = reportStatus.result.replace('(some ', '').slice(0, -1);
        assertEquals(reportString.includes(`reason: "${reportReason}"`), true);
        assertEquals(reportString.includes('status: "PENDING"'), true);
        assertEquals(reportString.includes('timestamp: u'), true);

        // Try to report again (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'crowd_fund',
                'report-campaign',
                [
                    types.uint(0),
                    types.utf8("Another report reason")
                ],
                user2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u110)'); // err-already-reported
    },
});