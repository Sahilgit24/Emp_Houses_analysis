const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const reviewSectionDefinitions = [
    ["overallPerformance", "Overall Performance"],
    ["whatIsGoingWell", "What Is Going Well"],
    ["needsAttention", "Needs Attention"],
    ["recommendedAction", "Recommended Action"],
];

const numericWords = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|once|twice|half)\b/i;

function getGeminiConfig(apiKey, model) {
    const env = import.meta.env || {};
    return {
        apiKey: apiKey || env.VITE_GEMINI_API_KEY || "",
        model: model || env.VITE_GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
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

function parseReview(content, summary, wasTruncated) {
    const reviewText = content
        .trim()
        .replace(/^```(?:text|markdown)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
    const sections = {};
    let activeSection = null;
    for (const line of reviewText.split(/\r?\n/)) {
        const cleanedLine = line.replace(/^#{1,6}\s*/, "").replace(/[*_`]/g, "").trim();
        const heading = cleanedLine.match(
            /^(?:[1-4][.)]\s*)?(Overall Performance|What Is Going Well|Needs Attention|Recommended Action)(?:\s*:\s*(.*))?$/i,
        );
        if (heading) {
            activeSection = reviewSectionDefinitions.find(([, title]) =>
                title.toLowerCase() === heading[1].toLowerCase()
            )?.[0] || null;
            if (activeSection && heading[2]) {
                sections[activeSection] = [sections[activeSection], heading[2].trim()]
                    .filter(Boolean)
                    .join("\n");
            }
            continue;
        }
        if (activeSection) {
            sections[activeSection] = [sections[activeSection], line.trim()]
                .filter(Boolean)
                .join("\n");
        }
    }

    const hasAllSections = reviewSectionDefinitions.every(([field]) => sections[field]?.trim());
    const canSeparateSections = hasAllSections && !wasTruncated;
    const unsectioned = canSeparateSections ? null : reviewText;
    const reviewedText = canSeparateSections
        ? reviewSectionDefinitions.map(([field]) => sections[field]).join("\n")
        : reviewText;
    const allowedNumbers = collectAllowedNumbers(summary);
    const hasUnverifiedClaim = hasUnverifiedNumbers(reviewedText, allowedNumbers) ||
        hasMisattributedPercentages(reviewedText, summary);
    return {
        sections: canSeparateSections
            ? Object.fromEntries(reviewSectionDefinitions.map(([field]) => [field, sections[field].trim()]))
            : {},
        unsectioned,
        formatWarning: wasTruncated
            ? "Gemini reached its response limit; the review may be incomplete. Its full response is shown below."
            : canSeparateSections
                ? null
                : "Gemini did not return all four section headings, so its full response is shown below.",
        validationWarning: hasUnverifiedClaim
            ? "The AI review is shown as generated, but some numeric claims could not be verified. Use the dashboard figures as authoritative."
            : null,
    };
}

export async function generateGeminiEmployeeReview(
    summary,
    {signal, fetchImpl = fetch, apiKey, model: requestedModel} = {},
) {
    const config = getGeminiConfig(apiKey, requestedModel);
    if (!config.apiKey) {
        throw new Error(
            "Gemini API key is missing. Add VITE_GEMINI_API_KEY to Route_optimisation_frontend/.env.local and restart Vite.",
        );
    }

    let response;
    try {
        response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": config.apiKey,
                },
                signal,
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{
                            text: [
                                "You are an Employee Collection Performance Reviewer.",
                                "Review the verified employee house-collection data provided below.",
                                "Your job is only to explain the results in simple, professional language.",
                                "Keep each section to one or two concise sentences.",
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
                                "Write a plain-text review with exactly these four section headings, each on its own line: 1. Overall Performance; 2. What Is Going Well; 3. Needs Attention; 4. Recommended Action.",
                                "Do not return JSON, code fences, or text outside the four sections.",
                            ].join(" "),
                        }],
                    },
                    contents: [{
                        role: "user",
                        parts: [{text: `Verified Data:\n${JSON.stringify(summary, null, 2)}`}],
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 1200,
                    },
                }),
            },
        );
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (error instanceof TypeError) {
            throw new Error("Could not reach the Gemini API. Check your internet connection and try again.");
        }
        throw error;
    }

    if (!response.ok) {
        let detail = "";
        try {
            const errorResult = await response.json();
            detail = errorResult?.error?.message || "";
        } catch {
            detail = "";
        }
        throw new Error(
            detail
                ? `Gemini API request failed: ${detail}`
                : `Gemini API request failed (HTTP ${response.status}).`,
        );
    }

    const result = await response.json();
    const candidate = result?.candidates?.[0];
    const content = candidate?.content?.parts
        ?.map((part) => part.text || "")
        .join("");
    if (typeof content !== "string" || !content.trim()) {
        throw new Error("Gemini returned no review. Try again.");
    }
    return parseReview(content, summary, candidate.finishReason === "MAX_TOKENS");
}
