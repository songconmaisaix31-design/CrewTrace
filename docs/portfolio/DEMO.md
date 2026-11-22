# Demonstration

1. Start the independent Web and Runtime, then enroll three separate worker identities for source inspection, CSV cleaning and evidence reporting. Run one Worker process per identity.
2. Join the workbench with a separate author identity. Publish a CSV task with capability `csv-data-review`, open its details, and configure a three-step workflow in automatic mode. Use public test records with header `record_id,amount_cents`.
3. Watch the inspection handoff arrive. Accept it from the author account. Accept the cleaned CSV and then the final report. Open each assignment snapshot to see the ranking, eligibility and prior samples.
4. Replay the cleaning evidence from the handoff and read the recorded reputation outcome. Create another task to compare the next cleaning decision. If multiple eligible cleaning workers are online, the updated reputation can affect their order.
5. Open Runs and benchmark to find the completed task and download the fixed-seed evaluation data. Present the simulation separately from the actual local test run.
