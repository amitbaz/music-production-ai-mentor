const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
}

const model = "gemini-3.5-flash-lite";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const response = await fetch(url, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
        contents: [
            {
                role: "user",
                parts: [{ text: "Say hello in 5 words" }],
            },
        ],
    }),
});

console.log(response.status);
console.log(JSON.stringify(await response.json(), null, 2));
