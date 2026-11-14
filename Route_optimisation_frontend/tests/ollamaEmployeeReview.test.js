import assert from "node:assert/strict";
import test from "node:test";
import {generateOllamaEmployeeReview} from "../src/services/ollamaEmployeeReview.js";

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

test("sends the calculated summary to local Ollama and parses the four review sections", async () => {
    let requestUrl;
    let requestBody;
    const review = await generateOllamaEmployeeReview(summary, {
        fetchImpl: async (url, options) => {
            requestUrl = url;
            requestBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({message: {content: JSON.stringify(validReview)}}),
            };
        },
    });

    assert.equal(requestUrl, "http://localhost:11434/api/chat");
    assert.equal(requestBody.model, "qwen2.5:7b");
    assert.match(requestBody.messages[0].content, /You are an Employee Collection Performance Reviewer/);
    assert.match(requestBody.messages[0].content, /Do not assume that every house must be scanned every day/);
    assert.match(requestBody.messages[0].content, /long collection gaps/);
    assert.equal(
        requestBody.messages[1].content,
        `Verified Data:\n${JSON.stringify(summary, null, 2)}`,
    );
    assert.equal(requestBody.stream, false);
    assert.deepEqual(review.sections, validReview);
    assert.equal(review.validationWarning, null);
});

test("displays the review and warns when it contains a number absent from the summary", async () => {
    const review = await generateOllamaEmployeeReview(summary, {
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                message: {
                    content: JSON.stringify({...validReview, overallPerformance: "Coverage is 90 percent."}),
                },
            }),
        }),
    });

    assert.equal(review.sections.overallPerformance, "Coverage is 90 percent.");
    assert.match(review.validationWarning, /some numeric claims could not be verified/);
});

test("displays the review and warns when it combines counts into a ratio", async () => {
    const review = await generateOllamaEmployeeReview(summary, {
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                message: {
                    content: JSON.stringify({
                        ...validReview,
                        overallPerformance: "The assigned employee collected 70 out of 120 houses.",
                    }),
                },
            }),
        }),
    });

    assert.equal(review.sections.overallPerformance, "The assigned employee collected 70 out of 120 houses.");
    assert.ok(review.validationWarning);
});

test("allows exact reporting dates but rejects changed dates", async () => {
    const fetchImpl = (date) => async () => ({
        ok: true,
        json: async () => ({
            message: {
                content: JSON.stringify({
                    ...validReview,
                    overallPerformance: `Reviewing activity from ${date} through 2026-11-12.`,
                }),
            },
        }),
    });

    await assert.doesNotReject(
        generateOllamaEmployeeReview(summary, {fetchImpl: fetchImpl("2026-10-14")}),
    );
    const changedDateReview = await generateOllamaEmployeeReview(
        summary,
        {fetchImpl: fetchImpl("2026-10-15")},
    );
    assert.match(changedDateReview.validationWarning, /some numeric claims could not be verified/);
});

test("requires collection-pattern percentages to retain their source denominator", async () => {
    const fetchImpl = (sentence) => async () => ({
        ok: true,
        json: async () => ({
            message: {
                content: JSON.stringify({
                    ...validReview,
                    whatIsGoingWell: sentence,
                }),
            },
        }),
    });

    await assert.doesNotReject(
        generateOllamaEmployeeReview(summary, {
            fetchImpl: fetchImpl("75% of houses with collection history followed the observed pattern."),
        }),
    );
    const misattributedReview = await generateOllamaEmployeeReview(summary, {
        fetchImpl: fetchImpl("75% of all houses followed the observed pattern."),
    });
    assert.ok(misattributedReview.validationWarning);
});

test("reports a missing local model without hiding the failure", async () => {
    await assert.rejects(
        generateOllamaEmployeeReview(summary, {
            fetchImpl: async () => ({ok: false, status: 404}),
        }),
        /could not find model "qwen2.5:7b"/i,
    );
});

test("reports a disconnected Ollama service clearly", async () => {
    await assert.rejects(
        generateOllamaEmployeeReview(summary, {
            fetchImpl: async () => {
                throw new TypeError("fetch failed");
            },
        }),
        /Could not reach Ollama at http:\/\/localhost:11434/,
    );
});
