let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);

if (request.input?.query === "fail" || request.input?.input === "fail") {
  process.stderr.write("intentional provider failure\n");
  process.exit(7);
}

if (
  request.input?.query === "slow" ||
  request.input?.input === "slow" ||
  request.input?.urls?.some((url) => url.includes("slow.test"))
) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

process.stderr.write(`custom ${request.capability} progress\n`);

switch (request.capability) {
  case "search":
    process.stdout.write(
      JSON.stringify({
        results: [
          {
            title: `Result for ${request.input.query}`,
            url: `https://example.test/${encodeURIComponent(request.input.query)}`,
            snippet: `cwd=${request.cwd}`,
            metadata: { options: request.options },
          },
        ],
      }),
    );
    break;
  case "contents":
    const answers = request.input.urls.map((url, inputIndex) =>
      url.includes("error")
        ? {
            inputIndex,
            url,
            error: { code: "PROVIDER_FAILURE", message: "could not fetch" },
          }
        : {
            inputIndex,
            url: url.includes("redirected.test")
              ? "https://canonical.test/article"
              : url.includes("normalized.test")
                ? "https://normalized.test/article"
                : url,
            content: `Contents of ${url}`,
            metadata: { options: request.options },
          },
    );
    if (
      request.input.urls.some(
        (url) =>
          url.includes("redirected.test") || url.includes("normalized.test"),
      )
    ) {
      answers.reverse();
    }
    process.stdout.write(
      JSON.stringify({
        answers,
      }),
    );
    break;
  case "answer":
    process.stdout.write(
      JSON.stringify({
        text: `Answer for ${request.input.query}`,
        itemCount: 1,
        metadata: {
          options: request.options,
          apiToken: "must-not-leak",
          echoedCredential: process.env.SAFE_SECRET,
        },
      }),
    );
    break;
  case "research":
    process.stdout.write(
      JSON.stringify({
        text: `Research for ${request.input.input}`,
        metadata: {
          schemaVersion: request.schemaVersion,
          options: request.options,
        },
      }),
    );
    break;
  default:
    process.exit(8);
}
