/**
 * FastUI Tailwind CSS Injection
 * Dynamically injects Tailwind CSS if not already present
 */

import { debugLog, loadScript } from '../utils/helpers';

/**
 * CDN URLs
 */
const TAILWIND_CDN = 'https://cdn.tailwindcss.com';
const FLOWBITE_CSS_CDN = 'https://cdn.jsdelivr.net/npm/flowbite@2.2.0/dist/flowbite.min.css';
const FLOWBITE_JS_CDN = 'https://cdn.jsdelivr.net/npm/flowbite@2.2.0/dist/flowbite.min.js';
const ECHARTS_CDN = 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';
const ALPINE_CDN = 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js';
const HTMX_CDN = 'https://cdn.jsdelivr.net/npm/htmx.org@1.9.10/dist/htmx.min.js';

/**
 * Check if a script is already loaded
 */
function isScriptLoaded(src: string): boolean {
  return document.querySelector(`script[src*="${src}"]`) !== null;
}

/**
 * Check if a stylesheet is already loaded
 */
function isStyleLoaded(href: string): boolean {
  return document.querySelector(`link[href*="${href}"]`) !== null;
}

/**
 * Check if Tailwind CSS is loaded
 */
export function hasTailwind(): boolean {
  const scripts = document.querySelectorAll('script[src*="tailwind"]');
  if (scripts.length > 0) return true;
  const styles = document.querySelectorAll('style');
  for (const style of styles) {
    if (style.textContent?.includes('tailwind') || style.textContent?.includes('--tw-')) {
      return true;
    }
  }
  return false;
}

/**
 * Load Tailwind CSS dynamically
 */
export async function loadTailwind(): Promise<void> {
  if (hasTailwind()) {
    debugLog('Tailwind already loaded');
    return;
  }
  try {
    await loadScript(TAILWIND_CDN);
    debugLog('Tailwind CSS loaded');
  } catch (e) {
    console.error('[FastUI] Failed to load Tailwind CSS:', e);
  }
}

/**
 * Load Flowbite CSS
 */
async function loadFlowbiteCSS(): Promise<void> {
  if (isStyleLoaded('flowbite')) {
    debugLog('Flowbite CSS already loaded');
    return;
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FLOWBITE_CSS_CDN;
    link.onload = () => { debugLog('Flowbite CSS loaded'); resolve(); };
    link.onerror = () => reject(new Error('Failed to load Flowbite CSS'));
    document.head.appendChild(link);
  });
}

/**
 * Load Flowbite JS
 */
async function loadFlowbiteJS(): Promise<void> {
  if (isScriptLoaded('flowbite')) {
    debugLog('Flowbite JS already loaded');
    return;
  }
  try {
    await loadScript(FLOWBITE_JS_CDN);
    debugLog('Flowbite JS loaded');
  } catch (e) {
    console.error('[FastUI] Failed to load Flowbite JS:', e);
  }
}

/**
 * Load Flowbite (CSS + JS)
 */
export async function loadFlowbite(): Promise<void> {
  await Promise.all([loadFlowbiteCSS(), loadFlowbiteJS()]);
}

/**
 * Load ECharts
 */
export async function loadECharts(): Promise<void> {
  if (isScriptLoaded('echarts') || typeof window.echarts !== 'undefined') {
    debugLog('ECharts already loaded');
    return;
  }
  try {
    await loadScript(ECHARTS_CDN);
    debugLog('ECharts loaded');
  } catch (e) {
    console.error('[FastUI] Failed to load ECharts:', e);
  }
}

/**
 * Load HTMX
 */
export async function loadHTMX(): Promise<void> {
  if (isScriptLoaded('htmx') || typeof window.htmx !== 'undefined') {
    debugLog('HTMX already loaded');
    return;
  }
  try {
    await loadScript(HTMX_CDN);
    debugLog('HTMX loaded');
  } catch (e) {
    console.error('[FastUI] Failed to load HTMX:', e);
  }
}

/**
 * Load Alpine.js - should be loaded LAST after directives are prepared
 */
export async function loadAlpine(): Promise<void> {
  if (isScriptLoaded('alpinejs') || typeof window.Alpine !== 'undefined') {
    debugLog('Alpine.js already loaded');
    return;
  }
  try {
    await loadScript(ALPINE_CDN);
    debugLog('Alpine.js loaded');
  } catch (e) {
    console.error('[FastUI] Failed to load Alpine.js:', e);
  }
}

/**
 * Load dependencies in correct order:
 * 1. Tailwind (styling)
 * 2. HTMX (AJAX) 
 * 3. ECharts (charts)
 * 4. Flowbite (UI components)
 * 5. Alpine.js LAST (reactivity - must be last so directives are ready)
 */
export async function loadAllDependencies(): Promise<void> {
  debugLog('Loading dependencies in order...');

  // Load non-Alpine dependencies first in parallel
  await Promise.all([
    loadTailwind(),
    loadHTMX(),
  ]);

  // Load optional dependencies
  await Promise.all([
    loadECharts().catch(() => debugLog('ECharts optional - skipped')),
    loadFlowbite().catch(() => debugLog('Flowbite optional - skipped')),
  ]);

  // Load Alpine LAST - it will auto-start and pick up directives
  await loadAlpine();

  debugLog('All dependencies loaded');
}

/**
 * Configure Tailwind with custom config
 */
export function configureTailwind(config: object): void {
  const tw = (window as unknown as { tailwind?: { config?: (c: object) => void } }).tailwind;
  if (tw?.config) {
    tw.config(config);
    debugLog('Tailwind configured');
  }
}

/**
 * Inject custom CSS
 */
export function injectCSS(css: string, id?: string): void {
  const style = document.createElement('style');
  if (id) style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
  debugLog('CSS injected', id);
}

/**
 * Default FastUI styles
 */
export const FASTUI_DEFAULT_STYLES = `
/* FastUI Default Styles */
[x-cloak] { display: none !important; }
.htmx-indicator { opacity: 0; transition: opacity 200ms ease-in; }
.htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }
[x-chart] { min-height: 200px; }
[x-lazy]:not([data-lazy-loaded="true"]) { min-height: 100px; }
`;
