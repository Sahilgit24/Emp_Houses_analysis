import assert from "node:assert/strict";
import test from "node:test";
import {generateGeminiEmployeeReview} from "../src/services/geminiEmployeeReview.js";

const summary = {
    employeeName: "Example employee",
    reportingPeriod: {from: "2026-10-14", through: "2026-11-12", days: 30},
    coverage: {
        totalHousesInBeat: 120,
        housesCollectedByAssignedEmployee: 70,
        housesCollectedByOtherEmployees: 26,
        housesWithAnyCollection: 96,
        housesNotCollected: 24,
        coveragePercent: 80,
        coverageDefinition: "Beat coverage includes houses collected by the assigned employee and houses collected by other employees.",
    },
    collectionRegularity: {
        regularlyCollectedHouses: 60,
        lowFrequencyHouses: 15,
        housesWithLongCollectionGaps: 5,
        overdueHouses: 5,
        housesRequiringAttention: 10,
        highPriorityHouses: 8,
        housesNotCollected: 24,
        housesWithCollectionHistory: 96,
        withinObservedPatternPercent: 75,
    },
    outsideBeatCollection: {distinctHousesCollected: null},
};

const validReview = {
    overallPerformance: "Beat coverage is 80%, with 70 houses collected by the assigned employee.",
    whatIsGoingWell: "The employee has recorded collection activity.",
    needsAttention: "Several houses remain in the high-priority group.",
    recommendedAction: "Review the high-priority houses and focus collection follow-up there.",
};

function generateReview(summaryValue, options = {}) {
    return generateGeminiEmployeeReview(summaryValue, {apiKey: "test-key", ...options});
}

function responseWithReview(review) {
    const labels = {
        overallPerformance: "1. Overall Performance",
        whatIsGoingWell: "2. What Is Going Well",
        needsAttention: "3. Needs Attention",
        recommendedAction: "4. Recommended Action",
    };
    const content = Object.entries(labels)
        .map(([key, label]) => `${label}\n${review[key]}`)
        .join("\n\n");
    return responseWithText(content);
}

function responseWithText(text, finishReason = "STOP") {
    return {
        ok: true,
        json: async () => ({
            candidates: [{content: {parts: [{text}]}, finishReason}],
        }),
    };
}

test("sends the calculated summary to Gemini and displays four plain-text sections", async () => {
    let requestUrl;
    let requestOptions;
    let requestBody;
    const review = await generateReview(summary, {
        fetchImpl: async (url, options) => {
            requestUrl = url;
            requestOptions = options;
            requestBody = JSON.parse(options.body);
            return responseWithReview(validReview);
        },
    });

    assert.equal(
        requestUrl,
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    assert.equal(requestOptions.headers["x-goog-api-key"], "test-key");
    assert.match(requestBody.systemInstruction.parts[0].text, /You are an Employee Collection Performance Reviewer/);
    assert.match(requestBody.systemInstruction.parts[0].text, /Do not assume that every house must be scanned every day/);
    assert.match(requestBody.systemInstruction.parts[0].text, /long collection gaps/);
    assert.match(requestBody.systemInstruction.parts[0].text, /Do not return JSON/);
    assert.match(requestBody.systemInstruction.parts[0].text, /one or two concise sentences/);
    assert.equal(
        requestBody.contents[0].parts[0].text,
        `Verified Data:\n${JSON.stringify(summary, null, 2)}`,
    );
    assert.equal(requestBody.generationConfig.responseMimeType, undefined);
    assert.equal(requestBody.generationConfig.responseSchema, undefined);
    assert.equal(requestBody.generationConfig.maxOutputTokens, 1200);
    assert.deepEqual(review.sections, validReview);
    assert.equal(review.unsectioned, null);
    assert.equal(review.validationWarning, null);
});

test("shows Gemini's full response when it does not return all section headings", async () => {
    const content = "The employee has recorded activity across the selected Beat.";
    const review = await generateReview(summary, {
        fetchImpl: async () => responseWithText(content),
    });

    assert.deepEqual(review.sections, {});
    assert.equal(review.unsectioned, content);
    assert.match(review.formatWarning, /full response is shown/);
});

test("warns when Gemini marks the review as truncated", async () => {
    const content = "1. Overall Performance\nThe report covers the selected Beat.";
    const review = await generateReview(summary, {
        fetchImpl: async () => responseWithText(content, "MAX_TOKENS"),
    });

    assert.equal(review.unsectioned, content);
    assert.match(review.formatWarning, /reached its response limit/);
});

test("parses Markdown-formatted section headings", async () => {
    const review = await generateReview(summary, {
        fetchImpl: async () => responseWithText([
            "## 1. Overall Performance",
            validReview.overallPerformance,
            "**2. What Is Going Well**",
            validReview.whatIsGoingWell,
            "### 3. Needs Attention",
            validReview.needsAttention,
            "4. Recommended Action:",
            validReview.recommendedAction,
        ].join("\n")),
    });

    assert.deepEqual(review.sections, validReview);
    assert.equal(review.unsectioned, null);
});

test("displays the review and warns when it contains a number absent from the summary", async () => {
    const review = await generateReview(summary, {
        fetchImpl: async () => responseWithReview({
            ...validReview,
            overallPerformance: "Coverage is 90 percent.",
        }),
    });

    assert.equal(review.sections.overallPerformance, "Coverage is 90 percent.");
    assert.match(review.validationWarning, /some numeric claims could not be verified/);
});

test("displays the review and warns when it combines counts into a ratio", async () => {
    const review = await generateReview(summary, {
        fetchImpl: async () => responseWithReview({
            ...validReview,
            overallPerformance: "The assigned employee collected 70 out of 120 houses.",
        }),
    });

    assert.equal(review.sections.overallPerformance, "The assigned employee collected 70 out of 120 houses.");
    assert.ok(review.validationWarning);
});

test("allows exact reporting dates but rejects changed dates", async () => {
    const fetchImpl = (date) => async () => responseWithReview({
        ...validReview,
        overallPerformance: `Reviewing activity from ${date} through 2026-11-12.`,
    });

    await assert.doesNotReject(
        generateReview(summary, {fetchImpl: fetchImpl("2026-10-14")}),
    );
    const changedDateReview = await generateReview(
        summary,
        {fetchImpl: fetchImpl("2026-10-15")},
    );
    assert.match(changedDateReview.validationWarning, /some numeric claims could not be verified/);
});

test("requires collection-pattern percentages to retain their source denominator", async () => {
    const fetchImpl = (sentence) => async () => responseWithReview({
        ...validReview,
        whatIsGoingWell: sentence,
    });

    await assert.doesNotReject(
        generateReview(summary, {
            fetchImpl: fetchImpl("75% of houses with collection history followed the observed pattern."),
        }),
    );
    const misattributedReview = await generateReview(summary, {
        fetchImpl: fetchImpl("75% of all houses followed the observed pattern."),
    });
    assert.ok(misattributedReview.validationWarning);
});

test("requires a Gemini API key", async () => {
    await assert.rejects(
        generateGeminiEmployeeReview(summary, {fetchImpl: async () => responseWithReview(validReview), apiKey: ""}),
        /VITE_GEMINI_API_KEY/,
    );
});

test("reports Gemini API errors and network failures clearly", async () => {
    await assert.rejects(
        generateReview(summary, {
            fetchImpl: async () => ({
                ok: false,
                status: 400,
                json: async () => ({error: {message: "API key not valid"}}),
            }),
        }),
        /Gemini API request failed: API key not valid/,
    );
    await assert.rejects(
        generateReview(summary, {
            fetchImpl: async () => {
                throw new TypeError("fetch failed");
            },
        }),
        /Could not reach the Gemini API/,
    );
});
