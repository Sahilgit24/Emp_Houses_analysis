import {Component} from "react";
import {AlertTriangle} from "lucide-react";

/** Keeps a crash in one tab from blanking the whole app. */
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = {error: null};
    }

    static getDerivedStateFromError(error) {
        return {error};
    }

    componentDidCatch(error, info) {
        console.error(`${this.props.label || "Section"} failed to render`, error, info?.componentStack);
    }

    componentDidUpdate(previousProps) {
        if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
            this.setState({error: null});
        }
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="flex h-full items-center justify-center p-6">
                <div role="alert" className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
                    <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600">
                        <AlertTriangle className="h-5 w-5" aria-hidden="true"/>
                    </div>
                    <h2 className="font-semibold text-slate-900">{this.props.label || "This section"} could not be displayed</h2>
                    <p className="mt-1 text-sm text-slate-600">
                        The other tabs still work. Try again, or refresh the data from the filter bar.
                    </p>
                    <p className="mt-3 break-words rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-500">
                        {this.state.error.message || String(this.state.error)}
                    </p>
                    <button
                        type="button"
                        onClick={() => this.setState({error: null})}
                        className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                        Try again
                    </button>
                </div>
            </div>
        );
    }
}
