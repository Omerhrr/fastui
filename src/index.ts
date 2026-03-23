/**
 * FastUI - Server-Driven Interactivity for FastStack
 * 
 * @version 0.1.6
 * @author Omerhrr
 * @license MIT
 */

import type { FastUIAPI, FastUIConfig, FastUIPlugin, AlpineDirective, EChartsOption, EChartsInstance } from './types';
import { mergeConfig, isBrowser, hasAlpine, debugLog } from './utils/helpers';
import { createFragmentCache, setupCacheMiddleware } from './utils/cache';
import { createStore, initAlpineStore } from './utils/store';
import { createChartDirective, updateChart, getChartInstance, disposeChart, resizeAllCharts } from './directives/chart';
import { createFlowDirective, initFlowbiteComponents, cleanupFlowbiteComponents } from './directives/flow';
import { createLazyDirective, createInitFragmentDirective } from './directives/lazy';
import { createHTMXPlugin, configureHTMXDefaults } from './plugins/htmx';
import { injectCSS, FASTUI_DEFAULT_STYLES } from './styles/tailwind';

declare const __VERSION__: string;

// CDN URLs
const CDN = {
  tailwind: 'https://cdn.tailwindcss.com',
  htmx: 'https://cdn.jsdelivr.net/npm/htmx.org@1.9.10/dist/htmx.min.js',
  echarts: 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js',
  alpine: 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js',
};

/**
 * Load a script and return promise
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Check if Alpine is loaded
 */
function isAlpineLoaded(): boolean {
  return typeof window.Alpine !== 'undefined';
}

/**
 * Check if ECharts is loaded  
 */
function isEChartsLoaded(): boolean {
  return typeof window.echarts !== 'undefined';
}

/**
 * Global Alpine directive registry - stores directives before Alpine loads
 */
const alpineDirectives: Array<{ name: string; callback: (el: HTMLElement, value: string, effect: () => void) => void }> = [];

/**
 * Register directive for Alpine (works before or after Alpine loads)
 */
function registerAlpineDirective(
  name: string, 
  callback: (el: HTMLElement, value: string, effect: () => void) => void
): void {
  // Store for later registration
  alpineDirectives.push({ name, callback });
  
  // If Alpine already loaded, register now
  if (isAlpineLoaded()) {
    try {
      window.Alpine.directive(name, callback);
      console.log(`[FastUI] Directive "${name}" registered with Alpine`);
    } catch (e) {
      console.error(`[FastUI] Failed to register directive "${name}":`, e);
    }
  }
}

/**
 * Register all pending directives with Alpine
 */
function flushDirectives(): void {
  if (!isAlpineLoaded()) return;
  
  alpineDirectives.forEach(({ name, callback }) => {
    try {
      window.Alpine.directive(name, callback);
      console.log(`[FastUI] Directive "${name}" flushed to Alpine`);
    } catch (e) {
      console.error(`[FastUI] Failed to flush directive "${name}":`, e);
    }
  });
}

/**
 * Create FastUI instance
 */
export function createFastUI(userConfig?: Partial<FastUIConfig>): FastUIAPI {
  const config = mergeConfig(userConfig);
  const store = createStore();
  const cache = createFragmentCache(config.cacheTTL);
  const plugins = new Map<string, FastUIPlugin>();
  const directives = new Map<string, AlpineDirective>();
  let initialized = false;

  /**
   * Initialize FastUI
   */
  async function init(): Promise<void> {
    if (initialized) return;
    
    console.log('[FastUI] Starting initialization...');
    
    try {
      // 1. Inject styles
      injectCSS(FASTUI_DEFAULT_STYLES, 'fastui-default-styles');
      
      // 2. Register directives FIRST (before Alpine loads)
      console.log('[FastUI] Pre-registering directives...');
      registerAlpineDirective('chart', createChartDirective().callback);
      registerAlpineDirective('flow', createFlowDirective().callback);
      registerAlpineDirective('lazy', createLazyDirective().callback);
      registerAlpineDirective('init-fragment', createInitFragmentDirective().callback);
      
      // 3. Set up Alpine interception
      setupAlpineInterceptor();
      
      // 4. Load Tailwind
      console.log('[FastUI] Loading Tailwind...');
      try {
        await loadScript(CDN.tailwind);
        console.log('[FastUI] Tailwind loaded');
      } catch (e) {
        console.warn('[FastUI] Tailwind load failed (may already be loaded)');
      }
      
      // 5. Load ECharts (for charts)
      console.log('[FastUI] Loading ECharts...');
      try {
        await loadScript(CDN.echarts);
        console.log('[FastUI] ECharts loaded:', isEChartsLoaded());
      } catch (e) {
        console.warn('[FastUI] ECharts load failed');
      }
      
      // 6. Load HTMX
      console.log('[FastUI] Loading HTMX...');
      try {
        await loadScript(CDN.htmx);
        console.log('[FastUI] HTMX loaded');
      } catch (e) {
        console.warn('[FastUI] HTMX load failed');
      }
      
      // 7. Load Alpine LAST
      console.log('[FastUI] Loading Alpine...');
      try {
        await loadScript(CDN.alpine);
        console.log('[FastUI] Alpine loaded:', isAlpineLoaded());
      } catch (e) {
        console.warn('[FastUI] Alpine load failed (may already be loaded)');
      }
      
      // 8. Flush directives to Alpine
      flushDirectives();
      
      // 9. Initialize store
      initAlpineStore();
      
      // 10. Setup HTMX plugin
      if (typeof window.htmx !== 'undefined') {
        const htmxPlugin = createHTMXPlugin();
        htmxPlugin.install(api);
        plugins.set('htmx', htmxPlugin);
        configureHTMXDefaults();
      }
      
      // 11. Setup cache
      if (config.cacheEnabled) {
        setupCacheMiddleware(cache);
      }
      
      initialized = true;
      console.log('[FastUI] ✅ Initialization complete');
      console.log('[FastUI] ECharts available:', isEChartsLoaded());
      console.log('[FastUI] Alpine available:', isAlpineLoaded());
      
      window.dispatchEvent(new CustomEvent('fastui:ready', { detail: { version: __VERSION__ } }));
    } catch (error) {
      console.error('[FastUI] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Set up Alpine interceptor to catch when Alpine loads
   */
  function setupAlpineInterceptor(): void {
    // If Alpine already loaded, flush immediately
    if (isAlpineLoaded()) {
      flushDirectives();
      return;
    }
    
    // Watch for Alpine to load
    const checkAlpine = setInterval(() => {
      if (isAlpineLoaded()) {
        clearInterval(checkAlpine);
        flushDirectives();
      }
    }, 10);
    
    // Stop checking after 5 seconds
    setTimeout(() => clearInterval(checkAlpine), 5000);
  }

  function registerPlugin(name: string, plugin: FastUIPlugin): void {
    if (plugins.has(name)) return;
    plugin.install(api);
    plugins.set(name, plugin);
  }

  function registerDirective(name: string, directive: AlpineDirective): void {
    if (directives.has(name)) return;
    registerAlpineDirective(name, directive.callback);
    directives.set(name, directive);
  }

  function reinit(el: HTMLElement): void {
    if (isAlpineLoaded() && (window.Alpine as unknown as { initTree?: Function }).initTree) {
      el.querySelectorAll('[x-data]').forEach((element) => {
        const htmlEl = element as HTMLElement;
        if (!(htmlEl as unknown as { __x?: unknown }).__x) {
          (window.Alpine as unknown as { initTree: Function }).initTree(htmlEl);
        }
      });
    }
    initFlowbiteComponents(el);
    resizeAllCharts();
  }

  async function lazyLoad(module: string): Promise<void> {
    switch (module) {
      case 'echarts': await loadScript(CDN.echarts); break;
      case 'htmx': await loadScript(CDN.htmx); break;
    }
  }

  async function createChart(el: HTMLElement, options: EChartsOption): Promise<EChartsInstance> {
    if (!isEChartsLoaded()) {
      await loadScript(CDN.echarts);
    }
    if (!isEChartsLoaded()) {
      throw new Error('[FastUI] ECharts not loaded');
    }
    const instance = window.echarts.init(el);
    instance.setOption(options);
    return instance;
  }

  const api: FastUIAPI = {
    version: __VERSION__,
    debug: config.debug || false,
    store,
    cache,
    plugins,
    directives,
    init,
    registerPlugin,
    registerDirective,
    reinit,
    lazyLoad,
    createChart,
    initFlowbite: (el: HTMLElement) => initFlowbiteComponents(el),
  };

  return api;
}

// Auto-initialize
if (isBrowser()) {
  const instance = createFastUI();
  window.FastUI = instance;

  const autoInit = () => {
    instance.init().catch((error) => {
      console.error('[FastUI] Auto-init failed:', error);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    setTimeout(autoInit, 0);
  }
}

export {
  createChartDirective,
  createFlowDirective,
  createLazyDirective,
  createHTMXPlugin,
  createFragmentCache,
  createStore,
  updateChart,
  getChartInstance,
  disposeChart,
  resizeAllCharts,
  initFlowbiteComponents,
  cleanupFlowbiteComponents,
  injectCSS,
  FASTUI_DEFAULT_STYLES,
};

export type {
  FastUIAPI,
  FastUIConfig,
  FastUIPlugin,
  AlpineDirective,
  ChartConfig,
  EChartsOption,
  EChartsInstance,
  FlowbiteComponentType,
  LazyLoadOptions,
  CachedFragment,
} from './types';
