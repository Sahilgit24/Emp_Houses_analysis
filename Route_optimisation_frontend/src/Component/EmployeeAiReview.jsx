import {useEffect, useRef, useState} from "react";
import {generateGeminiEmployeeReview} from "../services/geminiEmployeeReview.js";

const REVIEW_SECTIONS = [
    ["overallPerformance", "1. Overall Performance"],
    ["whatIsGoingWell", "2. What Is Going Well"],
    ["needsAttention", "3. Needs Attention"],
    ["recommendedAction", "4. Recommended Action"],
];

export default function EmployeeAiReview({summary}) {
    const [review, setReview] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const requestController = useRef(null);

    useEffect(() => {
        setReview(null);
        setError("");
        setLoading(false);
        return () => requestController.current?.abort();
    }, [summary]);

    const generateReview = async () => {
        requestController.current?.abort();
        const controller = new AbortController();
        requestController.current = controller;
        setLoading(true);
        setError("");
        setReview(null);
        try {
            const result = await generateGeminiEmployeeReview(summary, {signal: controller.signal});
            if (!controller.signal.aborted) setReview(result);
        } catch (requestError) {
            if (requestError?.name !== "AbortError") {
                setError(requestError instanceof Error
                    ? requestError.message
                    : "Could not generate the AI review.");
            }
        } finally {
            if (requestController.current === controller) {
                requestController.current = null;
                setLoading(false);
            }
        }
    };

    return (
        <section aria-labelledby="ai-review-heading" className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="ai-review-heading" className="text-lg font-semibold text-slate-900">AI Review</h2>
                    <p className="mt-1 text-xs text-slate-600">
                        Gemini · configured model. Uses the calculated summary only; figures above remain authoritative.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={generateReview}
                    disabled={loading}
                    className="rounded border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
                >
                    {loading ? "Generating review…" : review ? "Regenerate review" : "Generate AI review"}
                </button>
            </div>
            {loading && <p role="status" className="mt-3 text-sm text-slate-600">Waiting for Gemini review…</p>}
            {error && (
                <p role="alert" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    {error} Employee Analysis is still available.
                </p>
            )}
            {review?.validationWarning && (
                <p role="status" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    {review.validationWarning}
                </p>
            )}
            {review && (
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    {REVIEW_SECTIONS.map(([key, title]) => (
                        <div key={key} className="rounded-lg border border-slate-200 p-3">
                            <dt className="text-sm font-semibold text-slate-800">{title}</dt>
                            <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{review.sections[key]}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </section>
    );
}
