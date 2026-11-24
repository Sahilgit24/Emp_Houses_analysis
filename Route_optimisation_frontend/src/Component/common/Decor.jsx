// Small presentational pieces shared by every screen. They add visuals only, never data or wording.
import {avatarTone, initialsOf} from "./decorTones.js";

/** Large icon tile shown at the start of a page header. */
export function HeroIcon({icon: Icon, tone = "blue"}) {
    return (
        <span className={`hero-icon tone-${tone}`} aria-hidden="true">
            <Icon/>
        </span>
    );
}

/** Small tinted icon placed before a section heading. */
export function SectionIcon({icon: Icon, tone = "blue"}) {
    return (
        <span className={`section-icon tone-${tone}`} aria-hidden="true">
            <Icon/>
        </span>
    );
}

/** Corner icon used inside stat cards. */
export function StatIcon({icon: Icon, tone = "slate"}) {
    return (
        <span className={`stat-icon tone-${tone}`} aria-hidden="true">
            <Icon/>
        </span>
    );
}

/** Initials bubble shown before a person's name. */
export function Avatar({name}) {
    return (
        <span className={`avatar tone-${avatarTone(name)}`} aria-hidden="true">
            {initialsOf(name)}
        </span>
    );
}

/** Thin bar showing value as a share of total; renders nothing when there is no total. */
export function MiniBar({value, total, tone = "slate"}) {
    const numericValue = Number(value);
    const numericTotal = Number(total);
    if (!Number.isFinite(numericValue) || !Number.isFinite(numericTotal) || numericTotal <= 0) return null;
    const percent = Math.max(0, Math.min(100, numericValue / numericTotal * 100));
    return (
        <span className={`mini-bar tone-${tone}`} aria-hidden="true">
            <span style={{width: `${percent}%`}}/>
        </span>
    );
}
