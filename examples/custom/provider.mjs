let body = "";
for await (const chunk of process.stdin) body += chunk;

const request = JSON.parse(body);
if (request.schemaVersion !== 1) {
  process.stderr.write("unsupported schemaVersion\n");
  process.exit(2);
}

process.stderr.write(`running custom ${request.capability}\n`);

switch (request.capability) {
  case "search":
    process.stdout.write(
      JSON.stringify({
        results: [
          {
            title: `Example result for ${request.input.query}`,
            url: "https://example.com/",
            snippet: "Replace this branch with your search integration.",
          },
        ],
      }),
    );
    break;
  case "contents":
    process.stdout.write(
      JSON.stringify({
        answers: request.input.urls.map((url) => ({
          url,
          content: `Example contents for ${url}`,
        })),
      }),
    );
    break;
  case "answer":
    process.stdout.write(
      JSON.stringify({
        text: `Example answer for ${request.input.query}`,
      }),
    );
    break;
  case "research":
    process.stdout.write(
      JSON.stringify({
        text: `Example research report for ${request.input.input}`,
      }),
    );
    break;
  default:
    process.stderr.write("unsupported capability\n");
    process.exit(2);
}
