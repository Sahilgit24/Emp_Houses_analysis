// Maps the Tailwind text colour already used for a number to a matching accent tone.
export function toneFromTextClass(textClass = "") {
    if (/green|emerald/.test(textClass)) return "emerald";
    if (/amber|orange|yellow/.test(textClass)) return "amber";
    if (/red|rose/.test(textClass)) return "red";
    if (/blue|sky|indigo/.test(textClass)) return "blue";
    return "slate";
}

const AVATAR_TONES = ["blue", "emerald", "violet", "amber", "teal", "rose"];

export function avatarTone(name = "") {
    let hash = 0;
    for (const character of String(name)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function initialsOf(name = "") {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts.at(-1)[0];
    return letters.toUpperCase();
}
