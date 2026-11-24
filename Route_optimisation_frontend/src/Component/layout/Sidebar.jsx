import {NAV_ITEMS} from "./navItems.js";

export default function Sidebar({activePlanner, onSelect, allUlbsSelected}) {
    return (
        <aside className="app-sidebar shrink-0">
            <div className="app-brand">
                <div className="app-brand-mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M4.5 18.5 9 13l3 2.5 7.5-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <circle cx="4.5" cy="18.5" r="1.5" fill="currentColor"/>
                        <circle cx="19.5" cy="6.5" r="1.5" fill="currentColor"/>
                    </svg>
                </div>
                <div>
                    <p className="app-brand-title">Beat Operations</p>
                    <p className="app-brand-subtitle">Route planning & collection insights</p>
                </div>
            </div>
            <nav className="app-tabs" aria-label="Workspace sections">
                {NAV_ITEMS.map(({id, label, icon: Icon, allUlbs, disabledTitle}) => {
                    const disabled = allUlbsSelected && !allUlbs;
                    const active = activePlanner === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => onSelect(id)}
                            disabled={disabled}
                            className={`app-tab ${active ? "app-tab-active" : ""} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                            aria-current={active ? "page" : undefined}
                            title={disabled ? disabledTitle : undefined}
                        >
                            <span className="app-tab-icon" aria-hidden="true"><Icon/></span>
                            <span>{label}</span>
                        </button>
                    );
                })}
            </nav>
            <div className="app-sidebar-footer">
                <span className="app-sidebar-footer-dot" aria-hidden="true"/>
                Beat Operations
            </div>
        </aside>
    );
}
