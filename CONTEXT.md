# Domain Context

## Web Research

`web_research` starts an asynchronous research job. The caller receives a dispatch notice immediately, while the job continues in the background and later delivers a saved report.

A research job has a lifecycle: dispatch, active tracking, provider execution, progress updates, completion or failure, optional cancellation, artifact writing, result delivery, and cleanup.

A research artifact is the saved Markdown report for a finished research job. Its metadata lives in YAML frontmatter so history views can read job details without parsing report sections.
