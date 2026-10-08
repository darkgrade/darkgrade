/**
 * Shared by the font chooser component and the pre-paint bootstrap script, so
 * a reload applies the chosen fonts before first paint (and before the page
 * measures its text) rather than after.
 */

export type FontCategory = 'heading' | 'body' | 'mono'

export const FONT_CATEGORIES: readonly FontCategory[] = ['heading', 'body', 'mono']

export interface CategoryDefinition {
    label: string
    /** The design token (see @theme in globals.css) this category overrides. */
    cssVariable: string
    /** What the site uses today; a chosen font falls back to it while loading. */
    fallbackStack: string
}

export const CATEGORY_DEFINITIONS: Record<FontCategory, CategoryDefinition> = {
    heading: {
        label: 'Heading',
        cssVariable: '--font-serif',
        fallbackStack: 'var(--font-tay-flapjack), Georgia, serif',
    },
    body: {
        label: 'Body',
        cssVariable: '--font-sans',
        fallbackStack: 'var(--font-tay-road-runner), system-ui, sans-serif',
    },
    mono: {
        label: 'Mono',
        cssVariable: '--font-mono',
        fallbackStack: 'var(--font-tay-quick-draw), ui-monospace, monospace',
    },
}

export const DEV_FONT_API_PATH = '/api/dev-fonts'
export const STORAGE_KEY = 'darkgrade:dev-font-chooser:v1'
export const STYLE_ELEMENT_ID = 'dev-font-chooser-faces'

export const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

export type SelectedFonts = Record<FontCategory, string | null>

/**
 * Declares an @font-face per selected file and points each category's design
 * token at it. It is serialised into the bootstrap script below, so it must stay
 * self-contained: no references to anything outside its own body.
 */
export function applyDevFonts(
    selected: SelectedFonts,
    definitions: Record<string, CategoryDefinition>,
    apiPath: string,
    styleElementId: string
): void {
    let fontFaceRules = ''
    for (const category of Object.keys(definitions)) {
        const definition = definitions[category]
        const file = (selected as Record<string, string | null>)[category]
        if (!file) {
            document.documentElement.style.removeProperty(definition.cssVariable)
            continue
        }
        const family = JSON.stringify('dev:' + file)
        const url = JSON.stringify(apiPath + '?file=' + encodeURIComponent(file))
        // A weight range, so the browser never fakes a bold or light of a static file.
        fontFaceRules += '@font-face{font-family:' + family + ';src:url(' + url + ');font-weight:100 900;}'
        document.documentElement.style.setProperty(definition.cssVariable, family + ',' + definition.fallbackStack)
    }

    let styleElement = document.getElementById(styleElementId)
    if (!styleElement) {
        styleElement = document.createElement('style')
        styleElement.id = styleElementId
        document.head.appendChild(styleElement)
    }
    styleElement.textContent = fontFaceRules
}

/** Inline <head> script: re-applies the persisted selection before first paint. */
export const DEV_FONT_BOOTSTRAP_SCRIPT = `(function () {
    try {
        var loopback = ${JSON.stringify(LOOPBACK_HOSTNAMES)};
        if (loopback.indexOf(location.hostname) === -1) return;
        var stored = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null');
        if (!stored || !stored.selected) return;
        (${applyDevFonts.toString()})(
            stored.selected,
            ${JSON.stringify(CATEGORY_DEFINITIONS)},
            ${JSON.stringify(DEV_FONT_API_PATH)},
            ${JSON.stringify(STYLE_ELEMENT_ID)}
        );
    } catch (error) {}
})();`
