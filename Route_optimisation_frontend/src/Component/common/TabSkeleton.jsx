/** Placeholder shown while a tab's code is downloading. */
export default function TabSkeleton({label}) {
    return (
        <div className="h-full overflow-hidden p-6" role="status" aria-label={`Loading ${label}`}>
            <div className="mx-auto flex max-w-7xl animate-pulse flex-col gap-4">
                <div className="h-6 w-48 rounded-md bg-slate-200"/>
                <div className="h-4 w-96 max-w-full rounded-md bg-slate-200/80"/>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {Array.from({length: 4}, (_, index) => (
                        <div key={index} className="h-28 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"/>
                    ))}
                </div>
                <div className="h-72 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70"/>
            </div>
            <span className="sr-only">Loading {label}…</span>
        </div>
    );
}
