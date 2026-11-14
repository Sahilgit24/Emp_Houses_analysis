const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";

const reviewSchema = {
    type: "object",
    properties: {
        overallPerformance: {type: "string"},
        whatIsGoingWell: {type: "string"},
        needsAttention: {type: "string"},
        recommendedAction: {type: "string"},
    },
    required: [
        "overallPerformance",
        "whatIsGoingWell",
        "needsAttention",
        "recommendedAction",
    ],
    additionalProperties: false,
};

const numericWords = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|once|twice|half)\b/i;

function getOllamaConfig() {
    const env = import.meta.env || {};
    return {
        baseUrl: env.VITE_OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL,
        model: env.VITE_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    };
}

function collectAllowedNumbers(summary) {
    const numbers = new Set();
    const percentages = new Set();
    const dates = new Set();
    const collect = (value, key = "") => {
        if (typeof value === "number" && Number.isFinite(value)) {
            const normalized = String(value);
            numbers.add(normalized);
            if (/percent$/i.test(key)) percentages.add(normalized);
            return;
        }
        if (typeof value === "string" && /^(from|through|date)$/i.test(key) &&
            /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            dates.add(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item) => collect(item, key));
            return;
        }
        if (value && typeof value === "object") {
            Object.entries(value).forEach(([childKey, childValue]) => collect(childValue, childKey));
        }
    };
    collect(summary);
    return {numbers, percentages, dates};
}

function hasUnverifiedNumbers(text, allowedNumbers) {
    const textWithoutSourceDates = [...allowedNumbers.dates]
        .reduce((result, date) => result.split(date).join(""), text);
    if (numericWords.test(textWithoutSourceDates)) return true;
    if (/\b\d[\d,]*(?:\.\d+)?\s*(?:out of|of|\/)\s*\d[\d,]*(?:\.\d+)?\b/i.test(textWithoutSourceDates)) {
        return true;
    }
    const pattern = /(\d[\d,]*(?:\.\d+)?)(\s*%|\s+percent(?:age)?\b)?/gi;
    for (const match of textWithoutSourceDates.matchAll(pattern)) {
        const value = String(Number(match[1].replace(/,/g, "")));
        const isPercentage = Boolean(match[2]?.trim());
        if (isPercentage
            ? !allowedNumbers.percentages.has(value)
            : !allowedNumbers.numbers.has(value)) return true;
    }
    return false;
}

function hasMisattributedPercentages(text, summary) {
    const coveragePercent = summary.coverage?.coveragePercent;
    const observedPatternPercent = summary.collectionRegularity?.withinObservedPatternPercent;
    const pattern = /(\d[\d,]*(?:\.\d+)?)(\s*%|\s+percent(?:age)?\b)/gi;
    for (const match of text.matchAll(pattern)) {
        const value = Number(match[1].replace(/,/g, ""));
        const before = text.slice(0, match.index);
        const start = Math.max(
            before.lastIndexOf("."),
            before.lastIndexOf("!"),
            before.lastIndexOf("?"),
            before.lastIndexOf("\n"),
        ) + 1;
        const after = text.slice(match.index + match[0].length);
        const nextBoundary = after.search(/[.!?\n]/);
        const end = nextBoundary < 0 ? text.length : match.index + match[0].length + nextBoundary;
        const sentence = text.slice(start, end);
        const matchesCoverage = value === coveragePercent && /\b(?:beat )?coverage\b/i.test(sentence);
        const matchesObservedPattern = value === observedPatternPercent &&
            /\bhouses? with (?:a )?(?:collection )?history\b/i.test(sentence);
        if (!matchesCoverage && !matchesObservedPattern) return true;
    }
    return false;
}

function parseReview(content, summary) {
    let review;
    try {
        review = JSON.parse(content);
    } catch {
        throw new Error("Ollama returned a review in an unexpected format. Try again.");
    }

    const fields = Object.keys(reviewSchema.properties);
    if (!review || typeof review !== "object" ||
        Object.keys(review).length !== fields.length ||
        Object.keys(review).some((field) => !fields.includes(field)) ||
        fields.some((field) => typeof review[field] !== "string" || !review[field].trim())) {
        throw new Error("Ollama returned an unexpected four-section review format. Try again.");
    }
    const allowedNumbers = collectAllowedNumbers(summary);
    const hasUnverifiedClaim = fields.some((field) =>
        hasUnverifiedNumbers(review[field], allowedNumbers) ||
        hasMisattributedPercentages(review[field], summary)
    );
    return {
        sections: Object.fromEntries(fields.map((field) => [field, review[field].trim()])),
        validationWarning: hasUnverifiedClaim
            ? "The AI review is shown as generated, but some numeric claims could not be verified. Use the dashboard figures as authoritative."
            : null,
    };
}

export async function generateOllamaEmployeeReview(summary, {signal, fetchImpl = fetch} = {}) {
    const {baseUrl, model} = getOllamaConfig();
    let response;
    try {
        response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/chat`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            signal,
            body: JSON.stringify({
                model,
                stream: false,
                format: reviewSchema,
                options: {temperature: 0.1, num_predict: 400},
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are an Employee Collection Performance Reviewer.",
                            "Review the verified employee house-collection data provided below.",
                            "Your job is only to explain the results in simple, professional language.",
                            "Do not calculate, change, or invent any numbers. Use only the information provided.",
                            "Do not assume that every house must be scanned every day.",
                            "Return exactly these sections, in this order: 1. Overall Performance; 2. What Is Going Well; 3. Needs Attention; 4. Recommended Action.",
                            "Focus on Beat coverage, houses collected by the assigned employee, houses collected by other employees, uncollected houses, collection frequency, long collection gaps, houses requiring attention, and outside-Beat collection.",
                            "Beat coverage includes collection by both the assigned employee and other employees; never describe the assigned employee's count as total Beat coverage.",
                            "Use each count only for the category named in its field. Do not compare counts, infer a majority, or express counts as a ratio or 'x out of y'.",
                            "Use the supplied Beat coverage and collection-pattern percentages as written; do not derive or restate percentages from counts.",
                            "Keep each percentage attached to its exact definition and denominator: Beat coverage refers to housesWithAnyCollection among totalHousesInBeat; withinObservedPatternPercent refers only to housesWithCollectionHistory.",
                            "Whenever you mention withinObservedPatternPercent, explicitly state that it is among houses with collection history.",
                            "Do not describe a percentage as applying to all houses or to a different employee/category than its definition states.",
                            "Do not call a count a majority, significant portion, strong performance, or poor performance unless that exact assessment is explicitly supplied.",
                            "In Overall Performance, report Beat coverage, assigned-employee collections, other-employee collections, and uncollected houses under their separate labels.",
                            "In What Is Going Well, describe only recorded regular-collection counts or the observed-pattern percentage with its stated denominator.",
                            "In Needs Attention, describe low-frequency houses, long gaps, overdue houses, high-priority houses, and uncollected houses using their own labels; do not imply these categories are additive or distinct.",
                            "In Recommended Action, refer only to categories present in the summary; do not invent house IDs, routes, areas, or causes.",
                            "Only repeat numeric values exactly as supplied and with their original meaning; otherwise omit them.",
                            "Treat null values as unavailable and do not make claims or recommendations based on them.",
                            "Do not infer causes, routes, or house-level facts that are absent from the summary.",
                            "Return only the four JSON string fields defined by the response schema; the interface supplies the numbered section headings.",
                        ].join(" "),
                    },
                    {
                        role: "user",
                        content: `Verified Data:\n${JSON.stringify(summary, null, 2)}`,
                    },
                ],
            }),
        });
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (error instanceof TypeError) {
            throw new Error(`Could not reach Ollama at ${baseUrl}. Check that it is running and allows this app origin.`);
        }
        throw error;
    }

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Ollama could not find model "${model}". Check that the local Qwen model is installed.`);
        }
        throw new Error(`Ollama request failed (HTTP ${response.status}).`);
    }

    const result = await response.json();
    const content = result?.message?.content;
    if (typeof content !== "string") {
        throw new Error("Ollama returned no review. Try again.");
    }
    return parseReview(content, summary);
}
